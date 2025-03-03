// src/routes/v1/items/handlers/item.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { IItem, Item, IVariant } from "../../../../models/Item";
import { Supplier } from "../../../../models/Supplier";
import {
	BulkCreateItemBody,
	BulkItemUpdateBody,
} from "../../../../schemas/items";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";
import { ItemSortField } from "../../../../schemas/items";
import {
	CURRENCY_CONSTANTS,
	formatVNDPrice,
	validateVNDPrice,
} from "../../../../constants/currency.constants";
import { CONFIG } from "../../../../config/index";

export class ItemHandler {
	// Validation methods as static
	private static async validateSupplier(
		supplierId: string,
		session: mongoose.ClientSession
	): Promise<void> {
		if (!mongoose.Types.ObjectId.isValid(supplierId?.toString())) {
			throw CommonErrors.invalidFormat("supplier ID");
		}

		const supplier = await Supplier.findById(supplierId).session(session);
		if (!supplier) {
			throw CommonErrors.supplierNotFound();
		}

		if (supplier.status !== "active") {
			throw createBusinessError(`Supplier ${supplierId} is not active`);
		}
	}

	// Validate item names for duplicates
	private static async validateItemNames(
		items: Array<{ name: string; id?: string }>,
		session: mongoose.ClientSession
	): Promise<void> {
		// Normalize item names for consistent comparison
		const normalizedItems = items.map((item) => ({
			...item,
			normalizedName: item.name.toLowerCase().trim(),
		}));

		// Check for duplicates within the current batch
		const duplicateNamesMap = new Map<string, string[]>();

		normalizedItems.forEach((item) => {
			// Count occurrences of each normalized name and track the original names
			const itemsWithSameName = normalizedItems.filter(
				(i) => i.normalizedName === item.normalizedName
			);

			if (itemsWithSameName.length > 1) {
				duplicateNamesMap.set(
					item.normalizedName,
					itemsWithSameName.map((i) => i.name)
				);
			}
		});

		if (duplicateNamesMap.size > 0) {
			const duplicatesInfo = Array.from(duplicateNamesMap.entries())
				.map(([_, names]) => `"${names.join('", "')}"`)
				.join(", ");

			throw createBusinessError(
				`Duplicate item names found within request: ${duplicatesInfo}`
			);
		}

		// Extract actual names for database check
		const itemNames = normalizedItems.map((item) => item.normalizedName);

		// Prepare exclusion IDs for items being updated (not applicable in create)
		const excludeIds = items
			.filter((item) => item.id !== undefined)
			.map((item) => item.id as string)
			.filter((id) => mongoose.Types.ObjectId.isValid(id))
			.map((id) => new mongoose.Types.ObjectId(id));

		// Build the query
		const query: mongoose.FilterQuery<IItem> = {
			name: {
				$in: itemNames.map((name) => new RegExp(`^${name}$`, "i")),
			},
		};

		// Add exclusion if we have valid IDs
		if (excludeIds.length > 0) {
			query._id = { $nin: excludeIds };
		}

		// Check for duplicates against existing items in the database
		const existingItems = await Item.find(query)
			.select("name")
			.session(session)
			.lean();

		if (existingItems.length > 0) {
			const existingNames = existingItems.map((item) => item.name);
			throw createBusinessError(
				`Items with these names already exist: "${existingNames.join(
					'", "'
				)}"`
			);
		}
	}

	private static validateVariants(
		variants: IItem["variants"],
		existingSkus: Set<string>
	): void {
		if (!variants?.length) {
			throw createBusinessError("At least one variant is required");
		}

		const itemSkus = new Set<string>();

		for (const variant of variants) {
			if (existingSkus.has(variant.sku)) {
				throw createBusinessError(
					`Duplicate SKU found across items: ${variant.sku}`
				);
			}

			if (itemSkus.has(variant.sku)) {
				throw createBusinessError(
					`Duplicate SKU found within item variants: ${variant.sku}`
				);
			}

			itemSkus.add(variant.sku);
			existingSkus.add(variant.sku);

			// Validate price
			if (!validateVNDPrice(variant.price)) {
				throw createBusinessError(
					`Price for variant ${variant.sku} (${formatVNDPrice(
						variant.price
					)}) is invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
						CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
						CURRENCY_CONSTANTS.ITEM.MAX_PRICE
					)}`
				);
			}

			if (variant.price < 0) {
				throw createBusinessError(
					`Invalid price for SKU ${variant.sku}: price cannot be negative`
				);
			}

			if (variant.stockQuantity < 0) {
				throw createBusinessError(
					`Invalid stock quantity for SKU ${variant.sku}: cannot be negative`
				);
			}
		}
	}

	// Validate SKUs against existing items in the database
	private static async validateSkusAgainstDatabase(
		skus: string[],
		excludeItemIds: string[] = [],
		session: mongoose.ClientSession
	): Promise<void> {
		if (skus.length === 0) {
			return;
		}

		// Query to find any items with the same SKUs but not in the excluded item IDs
		const query: mongoose.FilterQuery<IItem> = {
			"variants.sku": { $in: skus },
		};

		// Add exclusion of item IDs if provided
		if (excludeItemIds.length > 0) {
			const objectIds = excludeItemIds
				.filter((id) => mongoose.Types.ObjectId.isValid(id))
				.map((id) => new mongoose.Types.ObjectId(id));

			if (objectIds.length > 0) {
				query._id = { $nin: objectIds };
			}
		}

		// Find items with these SKUs
		const existingItems = await Item.find(query)
			.select("name variants.sku")
			.session(session)
			.lean();

		if (existingItems.length > 0) {
			// Extract the conflicting SKUs with item names
			const conflicts: Record<string, string> = {};
			existingItems.forEach((item) => {
				item.variants.forEach((variant: IVariant) => {
					if (skus.includes(variant.sku)) {
						conflicts[variant.sku] = item.name;
					}
				});
			});

			const conflictMessages = Object.entries(conflicts).map(
				([sku, itemName]) =>
					`SKU "${sku}" already used in item "${itemName}"`
			);

			throw createBusinessError(
				`SKU conflicts detected: ${conflictMessages.join(", ")}`
			);
		}
	}

	private static validateItemPrices(item: Partial<IItem>): void {
		// Only validate variant prices
		if (item.variants) {
			item.variants.forEach((variant) => {
				if (!validateVNDPrice(variant.price)) {
					throw createBusinessError(
						`Price for variant ${variant.sku} (${formatVNDPrice(
							variant.price
						)}) is invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
							CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
							CURRENCY_CONSTANTS.ITEM.MAX_PRICE
						)}`
					);
				}
			});
		}
	}

	private static validateDiscount(discount?: {
		active?: boolean;
		percentage: number;
		startDate: string | Date;
		endDate: string | Date;
	}): void {
		if (!discount) return;

		const startDate = new Date(discount.startDate);
		const endDate = new Date(discount.endDate);

		if (isNaN(startDate.getTime())) {
			throw createBusinessError("Invalid discount start date format");
		}

		if (isNaN(endDate.getTime())) {
			throw createBusinessError("Invalid discount end date format");
		}

		if (startDate >= endDate) {
			throw createBusinessError(
				"Discount end date must be after start date"
			);
		}

		if (discount.percentage < 0 || discount.percentage > 100) {
			throw createBusinessError(
				"Discount percentage must be between 0 and 100"
			);
		}
	}

	private static validateDiscountedPrices(
		variants: IVariant[],
		discountPercentage: number
	): void {
		// Validate that discounted prices will still be valid VND amounts
		variants.forEach((variant) => {
			const discountedPrice = Math.round(
				variant.price * (1 - discountPercentage / 100)
			);
			if (!validateVNDPrice(discountedPrice)) {
				throw createBusinessError(
					`Discounted price for variant ${
						variant.sku
					} (${formatVNDPrice(
						discountedPrice
					)}) would be invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
						CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
						CURRENCY_CONSTANTS.ITEM.MAX_PRICE
					)}`
				);
			}
		});
	}

	async createItemsBulk(
		request: FastifyRequest<{ Body: Static<typeof BulkCreateItemBody> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { items } = request.body;
			const MAX_BULK_ITEMS = 20;

			if (items.length === 0) {
				throw createBusinessError("No items provided for creation");
			}

			if (items.length > MAX_BULK_ITEMS) {
				throw createBusinessError(
					`Cannot create more than ${MAX_BULK_ITEMS} items at once`
				);
			}

			Logger.debug(
				`Starting bulk creation of ${items.length} items`,
				"ItemHandler"
			);

			const allSkus = new Set<string>();

			// Prepare items for name validation
			const itemsForNameValidation = items.map((item) => ({
				name: item.name,
			}));

			try {
				// Validate item names (check for duplicates)
				await ItemHandler.validateItemNames(
					itemsForNameValidation,
					session
				);

				// Extract all SKUs from all variants to check globally
				const allNewSkus: string[] = [];
				items.forEach((item) => {
					item.variants.forEach((variant) => {
						allNewSkus.push(variant.sku);
					});
				});

				// Validate SKUs against database
				await ItemHandler.validateSkusAgainstDatabase(
					allNewSkus,
					[],
					session
				);

				// Sequential validation to prevent transaction issues
				const preparedItems = [];
				for (const itemData of items) {
					// Validate prices and variants first
					ItemHandler.validateItemPrices({
						...itemData,
						supplier: new mongoose.Types.ObjectId(
							itemData.supplier
						),
						discount: itemData.discount
							? {
									...itemData.discount,
									startDate: new Date(
										itemData.discount.startDate
									),
									endDate: new Date(
										itemData.discount.endDate
									),
							  }
							: undefined,
					});

					// Validate supplier
					await ItemHandler.validateSupplier(
						itemData.supplier?.toString(),
						session
					);

					// Local SKU validation (within the item)
					ItemHandler.validateVariants(itemData.variants, allSkus);

					// Validate discount if present
					if (itemData.discount) {
						// First validate discount structure and dates
						ItemHandler.validateDiscount(itemData.discount);

						// Then validate the resulting prices if discount is active
						if (itemData.discount.active) {
							ItemHandler.validateDiscountedPrices(
								itemData.variants,
								itemData.discount.percentage
							);
						}
					}

					preparedItems.push({
						...itemData,
						discount: itemData.discount
							? {
									...itemData.discount,
									startDate: new Date(
										itemData.discount.startDate
									),
									endDate: new Date(
										itemData.discount.endDate
									),
							  }
							: undefined,
					});
				}

				// Perform bulk insert within the same transaction
				const createdItems = await Item.insertMany(preparedItems, {
					session,
					ordered: true,
				});

				if (createdItems.length !== items.length) {
					throw createBusinessError(
						"Not all items were created successfully"
					);
				}

				Logger.info(
					`Successfully created ${createdItems.length} items in bulk`,
					"ItemHandler"
				);

				return reply.code(201).send({
					success: true,
					data: {
						items: createdItems,
						summary: {
							totalItems: createdItems.length,
							message: `Successfully created ${createdItems.length} items`,
						},
					},
				});
			} catch (error) {
				Logger.error(error as Error, "ItemHandler");

				if (error instanceof mongoose.Error.ValidationError) {
					throw createBusinessError(
						`Validation error: ${error.message}`
					);
				}

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("bulk item creation");
				}

				throw error;
			}
		}, "ItemHandler");
	}

	// Bulk update items
	async bulkUpdateItems(
		request: FastifyRequest<{ Body: Static<typeof BulkItemUpdateBody> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { items } = request.body;

			Logger.debug(
				`Starting bulk update for ${items.length} items`,
				"ItemHandler"
			);

			if (items.length === 0) {
				throw createBusinessError("No items provided for update");
			}

			// Validate all name updates first to prevent partial updates
			const itemsNeedingNameValidation = items
				.filter((item) => item.update?.name !== undefined)
				.map((item) => ({
					name: item.update!.name!,
					id: item.itemId,
				}));

			if (itemsNeedingNameValidation.length > 0) {
				await ItemHandler.validateItemNames(
					itemsNeedingNameValidation,
					session
				);
			}

			// Keep track of results
			const results = {
				total: items.length,
				updated: 0,
				skipped: 0,
				updatedItems: [] as any[],
				errors: [] as Array<{
					itemId: string;
					reason: string;
				}>,
			};

			// Process each item
			for (const itemUpdate of items) {
				try {
					const { itemId, update, variants, discount } = itemUpdate;

					if (!mongoose.Types.ObjectId.isValid(itemId)) {
						const reason = `Invalid itemId format: ${itemId}`;
						Logger.warn(reason, "ItemHandler");
						results.skipped++;
						results.errors.push({ itemId, reason });
						continue;
					}

					// Get current item
					const currentItem = await Item.findById(itemId).session(
						session
					);
					if (!currentItem) {
						const reason = `Item not found: ${itemId}`;
						Logger.warn(reason, "ItemHandler");
						results.skipped++;
						results.errors.push({ itemId, reason });
						continue;
					}

					// Prepare update object
					const updateData: any = {};

					// Add basic fields if provided
					if (update) {
						Object.keys(update).forEach((key) => {
							if (
								update[key as keyof typeof update] !== undefined
							) {
								updateData[key] =
									update[key as keyof typeof update];
							}
						});
					}

					// Handle supplier validation if being updated
					if (update?.supplier) {
						try {
							const supplier = await Supplier.findById(
								update.supplier
							).session(session);
							if (!supplier) {
								throw new Error(
									`Supplier not found: ${update.supplier}`
								);
							}

							if (supplier.status !== "active") {
								throw new Error(
									`Supplier is not active: ${update.supplier}`
								);
							}
						} catch (error) {
							const reason = `Supplier validation failed: ${
								error instanceof Error
									? error.message
									: "Unknown error"
							}`;
							Logger.warn(
								`${reason} for item ${itemId}`,
								"ItemHandler"
							);
							results.skipped++;
							results.errors.push({ itemId, reason });
							continue; // Skip this item update
						}
					}

					// Handle discount if provided
					if (discount) {
						// Validate discount dates
						try {
							const startDate = new Date(discount.startDate);
							const endDate = new Date(discount.endDate);

							if (
								isNaN(startDate.getTime()) ||
								isNaN(endDate.getTime())
							) {
								throw new Error("Invalid date format");
							}

							if (startDate >= endDate) {
								throw new Error(
									"End date must be after start date"
								);
							}

							updateData.discount = {
								percentage: discount.percentage,
								startDate,
								endDate,
								active: discount.active,
							};

							// Validate that discounted prices will still be valid
							const effectiveVariants = variants?.update
								? currentItem.variants.map((v: IVariant) => {
										const updateInfo =
											variants.update?.find(
												(u) => u.sku === v.sku
											);
										return updateInfo?.price !== undefined
											? { ...v, price: updateInfo.price }
											: v;
								  })
								: currentItem.variants;

							ItemHandler.validateDiscountedPrices(
								effectiveVariants,
								discount.percentage
							);
						} catch (error) {
							const errorMessage =
								error instanceof Error
									? error.message
									: "Unknown error";
							Logger.warn(
								`Invalid discount for item ${itemId}: ${errorMessage}`,
								"ItemHandler"
							);

							// Instead of silently skipping the discount, note the error but continue
							results.errors.push({
								itemId,
								reason: `Discount validation failed: ${errorMessage}`,
							});

							// Remove discount from updateData to skip updating it
							delete updateData.discount;
						}
					}

					// Handle variant changes
					if (variants) {
						// Track all SKUs to check for duplicates
						const existingSkus = new Set(
							currentItem.variants.map((v: IVariant) => v.sku)
						);

						// Collect new SKUs being added
						const newSkus: string[] = [];
						if (variants.add && variants.add.length > 0) {
							for (const newVariant of variants.add) {
								if (!existingSkus.has(newVariant.sku)) {
									newSkus.push(newVariant.sku);
								}
							}
						}

						// Validate new SKUs against database (excluding current item)
						if (newSkus.length > 0) {
							try {
								await ItemHandler.validateSkusAgainstDatabase(
									newSkus,
									[itemId], // Exclude current item
									session
								);
							} catch (error) {
								const reason = `SKU validation failed: ${
									error instanceof Error
										? error.message
										: "Unknown error"
								}`;
								Logger.warn(
									`${reason} for item ${itemId}`,
									"ItemHandler"
								);
								results.skipped++;
								results.errors.push({ itemId, reason });
								continue; // Skip this item update
							}
						}

						// Create a copy of the variants array to modify
						const updatedVariants = JSON.parse(
							JSON.stringify(currentItem.variants)
						);

						// Track variant-level errors
						const variantErrors: Array<{
							sku: string;
							reason: string;
						}> = [];

						// Process variant updates
						if (variants.update && variants.update.length > 0) {
							for (const variantUpdate of variants.update) {
								const existingVariantIndex =
									updatedVariants.findIndex(
										(v: IVariant) =>
											v.sku === variantUpdate.sku
									);

								if (existingVariantIndex === -1) {
									variantErrors.push({
										sku: variantUpdate.sku,
										reason: `Variant not found in item`,
									});
									continue;
								}

								// Create a new object that preserves all existing fields
								const updatedVariant = {
									...updatedVariants[existingVariantIndex],
								};

								// Apply updates
								if (variantUpdate.price !== undefined) {
									// Validate price
									if (
										!validateVNDPrice(variantUpdate.price)
									) {
										variantErrors.push({
											sku: variantUpdate.sku,
											reason: `Invalid price: ${variantUpdate.price}`,
										});
									} else {
										updatedVariant.price =
											variantUpdate.price;
									}
								}

								if (variantUpdate.stockQuantity !== undefined) {
									if (variantUpdate.stockQuantity < 0) {
										variantErrors.push({
											sku: variantUpdate.sku,
											reason: `Invalid stock quantity: ${variantUpdate.stockQuantity}`,
										});
									} else {
										updatedVariant.stockQuantity =
											variantUpdate.stockQuantity;
									}
								}

								if (
									variantUpdate.lowStockThreshold !==
									undefined
								) {
									updatedVariant.lowStockThreshold =
										variantUpdate.lowStockThreshold;
								}

								if (variantUpdate.specifications) {
									updatedVariant.specifications = {
										...updatedVariant.specifications,
										...variantUpdate.specifications,
									};
								}

								// Replace the variant
								updatedVariants[existingVariantIndex] =
									updatedVariant;
							}
						}

						// Process variant removals
						if (variants.remove && variants.remove.length > 0) {
							// Filter out variants to be removed
							const filteredVariants = updatedVariants.filter(
								(v: IVariant) =>
									!variants.remove?.includes(v.sku)
							);

							// Ensure we have at least one variant left
							if (filteredVariants.length === 0) {
								results.errors.push({
									itemId,
									reason: "Cannot remove all variants from item",
								});
							} else {
								// Update the variants array
								updatedVariants.length = 0;
								updatedVariants.push(...filteredVariants);
							}
						}

						// Process variant additions
						if (variants.add && variants.add.length > 0) {
							// Validate new variants
							for (const newVariant of variants.add) {
								if (existingSkus.has(newVariant.sku)) {
									variantErrors.push({
										sku: newVariant.sku,
										reason: "Duplicate SKU within item",
									});
									continue;
								}

								// Validate price
								if (!validateVNDPrice(newVariant.price)) {
									variantErrors.push({
										sku: newVariant.sku,
										reason: `Invalid price: ${newVariant.price}`,
									});
									continue;
								}

								existingSkus.add(newVariant.sku);
								updatedVariants.push(newVariant);
							}
						}

						// If there were any variant-level errors, add them to the item's errors
						if (variantErrors.length > 0) {
							results.errors.push({
								itemId,
								reason: `Variant issues: ${variantErrors
									.map(
										(ve) => `SKU "${ve.sku}": ${ve.reason}`
									)
									.join("; ")}`,
							});
						}

						// Update the variants in the update data
						updateData.variants = updatedVariants;
					}

					// Apply updates to the item
					let updatedItem;
					try {
						// First try the update using findByIdAndUpdate
						updatedItem = await Item.findByIdAndUpdate(
							itemId,
							{ $set: updateData },
							{ new: true, runValidators: true, session }
						);

						if (!updatedItem) {
							throw new Error("Failed to update item");
						}
					} catch (updateError) {
						// If direct update fails, try the update using save
						try {
							Logger.warn(
								`Standard update failed for ${itemId}, trying alternative approach: ${
									updateError instanceof Error
										? updateError.message
										: "Unknown error"
								}`,
								"ItemHandler"
							);

							// Get the item again
							const itemToUpdate = await Item.findById(
								itemId
							).session(session);
							if (!itemToUpdate) {
								throw new Error("Item not found");
							}

							// Apply updates directly to the document
							Object.keys(updateData).forEach((key) => {
								(itemToUpdate as any)[key as keyof IItem] =
									updateData[key as keyof typeof updateData];
							});

							// Save with validation
							updatedItem = await itemToUpdate.save({ session });
						} catch (fallbackError) {
							const errorMessage =
								fallbackError instanceof Error
									? fallbackError.message
									: "Unknown error";
							Logger.error(
								fallbackError instanceof Error
									? fallbackError
									: new Error(errorMessage),
								"ItemHandler"
							);
							results.skipped++;
							results.errors.push({
								itemId,
								reason: `Database error: ${errorMessage}`,
							});
							continue;
						}
					}

					if (updatedItem) {
						results.updated++;
						results.updatedItems.push(updatedItem);
						Logger.info(
							`Successfully updated item: ${itemId}`,
							"ItemHandler"
						);
					} else {
						results.skipped++;
						results.errors.push({
							itemId,
							reason: "Update failed for unknown reason",
						});
						Logger.warn(
							`Failed to update item: ${itemId}`,
							"ItemHandler"
						);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error
							? error.message
							: "Unknown error";
					Logger.error(
						error instanceof Error
							? error
							: new Error(errorMessage),
						"ItemHandler"
					);
					results.skipped++;
					results.errors.push({
						itemId: itemUpdate.itemId,
						reason: errorMessage,
					});
				}
			}

			Logger.info(
				`Bulk update completed: ${results.updated} updated, ${results.skipped} skipped`,
				"ItemHandler"
			);

			return reply.code(200).send({
				success: true,
				data: {
					items: results.updatedItems,
					summary: {
						total: results.total,
						updated: results.updated,
						skipped: results.skipped,
						message: `Successfully updated ${results.updated} items, skipped ${results.skipped} items`,
						errors:
							results.errors.length > 0
								? results.errors
								: undefined,
					},
				},
			});
		}, "ItemHandler");
	}

	// Get item by ID
	async getItem(
		request: FastifyRequest<{ Params: { itemId: string } }>,
		reply: FastifyReply
	) {
		const { itemId } = request.params;

		if (!mongoose.Types.ObjectId.isValid(itemId)) {
			throw CommonErrors.invalidFormat("item ID");
		}

		const item = await Item.findById(itemId).populate(
			"supplier",
			"name code status"
		);

		if (!item) {
			throw CommonErrors.itemNotFound();
		}

		return reply.send({
			success: true,
			data: { item },
		});
	}

	// Delete item
	async deleteItem(
		request: FastifyRequest<{ Params: { itemId: string } }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { itemId } = request.params;

			if (!mongoose.Types.ObjectId.isValid(itemId)) {
				throw CommonErrors.invalidFormat("item ID");
			}

			const item = await Item.findById(itemId).session(session);
			if (!item) {
				throw CommonErrors.itemNotFound();
			}

			if (item.numberOfSales > 0) {
				// Instead of deleting, mark as discontinued
				item.status = "discontinued";
				await item.save({ session });

				Logger.info(
					`Item marked as discontinued: ${itemId}`,
					"ItemHandler"
				);
				return reply.send({
					success: true,
					data: {
						message:
							"Item marked as discontinued due to existing sales",
					},
				});
			}

			await Item.deleteOne({ _id: itemId }).session(session);
			Logger.info(`Item deleted successfully: ${itemId}`, "ItemHandler");

			return reply.send({
				success: true,
				data: { message: "Item deleted successfully" },
			});
		}, "ItemHandler");
	}

	// List items with filtering, sorting and pagination (Including search)
	async listItems(
		request: FastifyRequest<{
			Querystring: {
				page?: number;
				limit?: number;
				search?: string;
				tags?: string | string[];
				minPrice?: number;
				maxPrice?: number;
				status?: "active" | "discontinued" | "draft";
				supplier?: string;
				minRating?: number;
				inStock?: boolean;
				sortBy?: ItemSortField;
				sortOrder?: "asc" | "desc";
			};
		}>,
		reply: FastifyReply
	) {
		try {
			const {
				page = 1,
				limit = 10,
				search,
				tags,
				minPrice,
				maxPrice,
				status,
				supplier,
				minRating,
				inStock,
				sortBy = "createdAt",
				sortOrder = "desc",
			} = request.query;

			// Enhanced pagination validation
			const validatedPage = Math.max(1, Math.floor(Number(page)));
			const validatedLimit = Math.min(
				100,
				Math.max(1, Math.floor(Number(limit)))
			);

			// Create base filter object
			const baseFilters: mongoose.FilterQuery<IItem> = {};

			// Add status filter if provided
			if (status) {
				baseFilters.status = status;
			}

			// Add supplier filter with validation
			if (supplier) {
				if (!mongoose.Types.ObjectId.isValid(supplier)) {
					throw CommonErrors.invalidFormat("supplier ID");
				}
				baseFilters.supplier = new mongoose.Types.ObjectId(supplier);
			}

			// Add rating filter with validation
			if (minRating !== undefined && minRating >= 0 && minRating <= 5) {
				baseFilters["ratings.average"] = { $gte: minRating };
			}

			// Tags filter with validation
			if (tags) {
				const tagArray = Array.isArray(tags)
					? tags
					: tags
							.split(",")
							.map((tag) => tag.trim())
							.filter(Boolean);
				if (tagArray.length > 0) {
					baseFilters.tags = { $all: tagArray };
				}
			}

			// Initialize pipeline
			const pipeline: mongoose.PipelineStage[] = [];

			// Handle text search if provided using Atlas Search
			if (search?.trim()) {
				// Create a cleaned search term
				const cleanedSearch = search.trim().toLowerCase();

				// Tokenize the search query for more granular matching
				const searchTokens = cleanedSearch
					.split(/\s+/)
					.filter((token) => token.length > 1);

				pipeline.push(
					{
						$search: {
							index: "items_search",
							compound: {
								should: [
									// Exact phrase matching with highest priority
									{
										text: {
											query: cleanedSearch,
											path: "name",
											score: { boost: { value: 10 } },
										},
									},
									// Individual term matching on name
									{
										text: {
											query: cleanedSearch,
											path: "name",
											fuzzy: {
												maxEdits: 1,
												prefixLength: 2,
											},
											score: { boost: { value: 5 } },
										},
									},
									// Tag matching
									{
										text: {
											query: cleanedSearch,
											path: "tags",
											fuzzy: {
												maxEdits: 1,
												prefixLength: 1,
											},
											score: { boost: { value: 3 } },
										},
									},
									// Autocomplete for partial matching
									{
										autocomplete: {
											query: cleanedSearch,
											path: "name",
											tokenOrder: "sequential",
											fuzzy: {
												maxEdits: 1,
												prefixLength: 2,
											},
											score: { boost: { value: 2 } },
										},
									},
								],
							},
							highlight: { path: ["name", "tags"] },
						},
					},
					{
						$addFields: {
							searchScore: { $meta: "searchScore" },
							highlights: { $meta: "searchHighlights" },
						},
					}
				);
			}

			// Apply base filters
			if (Object.keys(baseFilters).length > 0) {
				pipeline.push({ $match: baseFilters });
			}

			// Stock filtering
			if (inStock !== undefined) {
				pipeline.push({
					$match: {
						variants: {
							$elemMatch: {
								stockQuantity: inStock ? { $gt: 0 } : 0,
							},
						},
					},
				});
			} else {
				// By default we only show in-stock items
				pipeline.push({
					$match: {
						variants: {
							$elemMatch: {
								stockQuantity: { $gt: 0 },
							},
						},
					},
				});
			}

			// Add price calculation stages
			pipeline.push(
				// Calculate lowest price from variants
				{
					$addFields: {
						lowestPrice: { $min: "$variants.price" },
					},
				},

				// Calculate effective price with discounts (for item-level sorting and filtering)
				{
					$addFields: {
						effectivePrice: {
							$cond: {
								if: {
									$and: [
										{ $eq: ["$discount.active", true] },
										{
											$lt: [
												"$discount.startDate",
												"$$NOW",
											],
										},
										{ $gt: ["$discount.endDate", "$$NOW"] },
									],
								},
								then: {
									$round: [
										{
											$multiply: [
												"$lowestPrice",
												{
													$subtract: [
														1,
														{
															$divide: [
																"$discount.percentage",
																100,
															],
														},
													],
												},
											],
										},
									],
								},
								else: "$lowestPrice",
							},
						},
					},
				},

				// Calculate effective price for each variant
				{
					$addFields: {
						variants: {
							$map: {
								input: "$variants",
								as: "variant",
								in: {
									$mergeObjects: [
										"$$variant",
										{
											effectivePrice: {
												$cond: {
													if: {
														$and: [
															{
																$eq: [
																	"$discount.active",
																	true,
																],
															},
															{
																$lt: [
																	"$discount.startDate",
																	"$$NOW",
																],
															},
															{
																$gt: [
																	"$discount.endDate",
																	"$$NOW",
																],
															},
														],
													},
													then: {
														$round: [
															{
																$multiply: [
																	"$$variant.price",
																	{
																		$subtract:
																			[
																				1,
																				{
																					$divide:
																						[
																							"$discount.percentage",
																							100,
																						],
																				},
																			],
																	},
																],
															},
														],
													},
													else: "$$variant.price",
												},
											},
											discountPercentage: {
												$cond: {
													if: {
														$and: [
															{
																$eq: [
																	"$discount.active",
																	true,
																],
															},
															{
																$lt: [
																	"$discount.startDate",
																	"$$NOW",
																],
															},
															{
																$gt: [
																	"$discount.endDate",
																	"$$NOW",
																],
															},
														],
													},
													then: "$discount.percentage",
													else: 0,
												},
											},
										},
									],
								},
							},
						},
					},
				}
			);

			// Price range filter - apply after calculating effectivePrice
			if (minPrice !== undefined || maxPrice !== undefined) {
				const priceFilter: any = {};
				if (minPrice !== undefined) priceFilter.$gte = minPrice;
				if (maxPrice !== undefined) priceFilter.$lte = maxPrice;

				pipeline.push({
					$match: {
						effectivePrice: priceFilter,
					},
				});
			}

			// Create a copy of the pipeline for counting, without sorting/pagination
			const countPipeline = [...pipeline];

			// Add combined scoring and ranking for search results
			if (search?.trim()) {
				pipeline.push({
					$addFields: {
						// Combine search score with other relevance signals
						combinedScore: {
							$add: [
								{ $multiply: ["$searchScore", 1.0] }, // Search match
								{ $multiply: ["$ratings.average", 0.2] }, // Rating score
								{
									$multiply: [
										{ $divide: ["$numberOfSales", 100] }, // Sales popularity
										0.3,
									],
								},
							],
						},
					},
				});

				// Sort by combined score instead of just search score
				pipeline.push({
					$sort: { combinedScore: -1 },
				});
			} else if (sortBy === "effectivePrice") {
				pipeline.push({
					$sort: { effectivePrice: sortOrder === "desc" ? -1 : 1 },
				});
			} else {
				pipeline.push({
					$sort: { [sortBy]: sortOrder === "desc" ? -1 : 1 },
				});
			}

			// Add search debug info in development mode
			const isDevelopment = CONFIG.NODE_ENV === "development";
			if (isDevelopment && search?.trim()) {
				pipeline.push({
					$addFields: {
						_searchDebug: {
							score: "$searchScore",
							combinedScore: "$combinedScore",
							highlights: "$highlights",
							matchedOn: {
								$cond: {
									if: {
										$gt: [
											{
												$size: {
													$ifNull: [
														"$highlights",
														[],
													],
												},
											},
											0,
										],
									},
									then: {
										$map: {
											input: "$highlights",
											as: "highlight",
											in: {
												path: "$$highlight.path",
												texts: "$$highlight.texts.value",
											},
										},
									},
									else: "No explicit matches",
								},
							},
						},
					},
				});
			}

			// Add pagination
			pipeline.push(
				{ $skip: (validatedPage - 1) * validatedLimit },
				{ $limit: validatedLimit }
			);

			// Execute queries with proper count
			const [items, countResult] = await Promise.all([
				Item.aggregate(pipeline),
				Item.aggregate([...countPipeline, { $count: "total" }]),
			]);

			const total = countResult.length > 0 ? countResult[0].total : 0;
			const totalPages = Math.ceil(total / validatedLimit);

			// Validate requested page number
			if (validatedPage > totalPages && total > 0) {
				throw CommonErrors.invalidFormat(
					`Page ${validatedPage} exceeds available pages (${totalPages})`
				);
			}

			Logger.debug(
				`Retrieved ${items.length} items (page ${validatedPage} of ${totalPages})`,
				"ItemHandler"
			);

			// Remove debug info for production responses
			const responseItems = items.map((item) => {
				if (!isDevelopment) {
					// Remove debug info in production
					const { _searchDebug, ...cleanItem } = item;
					return {
						...cleanItem,
						highlights: item.highlights || undefined, // Include search highlights when available
					};
				}
				return item;
			});

			return reply.send({
				success: true,
				data: {
					items: responseItems,
					pagination: {
						total,
						page: validatedPage,
						totalPages,
						hasNext: validatedPage < totalPages,
						hasPrev: validatedPage > 1,
					},
				},
			});
		} catch (error) {
			Logger.error(error as Error, "ItemHandler");
			if (error instanceof mongoose.Error) {
				throw CommonErrors.databaseError("item retrieval");
			}
			throw error;
		}
	}

	// Update item stock
	async updateStock(
		request: FastifyRequest<{
			Params: { itemId: string };
			Body: { variantSku: string; quantity: number };
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { itemId } = request.params;
			const { variantSku, quantity } = request.body;

			if (!mongoose.Types.ObjectId.isValid(itemId)) {
				throw CommonErrors.invalidFormat("item ID");
			}

			const item = await Item.findById(itemId).session(session);
			if (!item) {
				throw CommonErrors.itemNotFound();
			}

			const variant = item.variants.find(
				(v: any) => v.sku === variantSku
			);
			if (!variant) {
				throw createBusinessError("Variant not found");
			}

			if (variant.stockQuantity + quantity < 0) {
				throw createBusinessError("Insufficient stock");
			}

			variant.stockQuantity += quantity;
			await item.save({ session });

			Logger.info(
				`Stock updated for item ${itemId}, variant ${variantSku}`,
				"ItemHandler"
			);
			return reply.send({
				success: true,
				data: {
					item,
					stockUpdate: {
						variantSku,
						newQuantity: variant.stockQuantity,
						adjustment: quantity,
					},
				},
			});
		}, "ItemHandler");
	}
}
