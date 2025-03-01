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

			try {
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

			// Keep track of results
			const results = {
				total: items.length,
				updated: 0,
				skipped: 0,
				updatedItems: [] as any[],
			};

			// Process each item
			for (const itemUpdate of items) {
				try {
					const { itemId, update, variants, discount } = itemUpdate;

					if (!mongoose.Types.ObjectId.isValid(itemId)) {
						Logger.warn(
							`Skipping update for invalid itemId: ${itemId}`,
							"ItemHandler"
						);
						results.skipped++;
						continue;
					}

					// Get current item
					const currentItem = await Item.findById(itemId).session(
						session
					);
					if (!currentItem) {
						Logger.warn(
							`Item not found: ${itemId}, skipping update`,
							"ItemHandler"
						);
						results.skipped++;
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
						const supplier = await Supplier.findById(
							update.supplier
						).session(session);
						if (!supplier) {
							Logger.warn(
								`Supplier not found: ${update.supplier}, skipping item update for ${itemId}`,
								"ItemHandler"
							);
							results.skipped++;
							continue;
						}

						if (supplier.status !== "active") {
							Logger.warn(
								`Supplier is not active: ${update.supplier}, skipping item update for ${itemId}`,
								"ItemHandler"
							);
							results.skipped++;
							continue;
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
								`Invalid discount for item ${itemId}: ${errorMessage}, skipping discount update`,
								"ItemHandler"
							);
							// Continue with other updates, just skip discount
						}
					}

					// Handle variant changes
					if (variants) {
						// Track all SKUs to check for duplicates
						const existingSkus = new Set(
							currentItem.variants.map((v: IVariant) => v.sku)
						);

						// Create a copy of the variants array to modify
						const updatedVariants = JSON.parse(
							JSON.stringify(currentItem.variants)
						);

						// Process variant updates
						if (variants.update && variants.update.length > 0) {
							for (const variantUpdate of variants.update) {
								const existingVariantIndex =
									updatedVariants.findIndex(
										(v: IVariant) =>
											v.sku === variantUpdate.sku
									);

								if (existingVariantIndex === -1) {
									Logger.warn(
										`Variant with SKU ${variantUpdate.sku} not found in item ${itemId}, skipping variant update`,
										"ItemHandler"
									);
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
										Logger.warn(
											`Invalid price for variant ${variantUpdate.sku}: ${variantUpdate.price}, skipping price update`,
											"ItemHandler"
										);
									} else {
										updatedVariant.price =
											variantUpdate.price;
									}
								}

								if (variantUpdate.stockQuantity !== undefined) {
									if (variantUpdate.stockQuantity < 0) {
										Logger.warn(
											`Invalid stock quantity for variant ${variantUpdate.sku}: ${variantUpdate.stockQuantity}, skipping quantity update`,
											"ItemHandler"
										);
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
								Logger.warn(
									`Cannot remove all variants from item ${itemId}, skipping variant removal`,
									"ItemHandler"
								);
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
									Logger.warn(
										`Duplicate SKU ${newVariant.sku} in item ${itemId}, skipping variant addition`,
										"ItemHandler"
									);
									continue;
								}

								// Validate price
								if (!validateVNDPrice(newVariant.price)) {
									Logger.warn(
										`Invalid price for new variant ${newVariant.sku}: ${newVariant.price}, skipping variant addition`,
										"ItemHandler"
									);
									continue;
								}

								existingSkus.add(newVariant.sku);
								updatedVariants.push(newVariant);
							}
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
				pipeline.push(
					{
						$search: {
							index: "items_search", // Make sure to create this index in Atlas
							compound: {
								should: [
									{
										text: {
											query: search.trim(),
											path: "name",
											fuzzy: {
												maxEdits: 1,
												prefixLength: 1,
											},
											score: { boost: { value: 5 } },
										},
									},
									{
										text: {
											query: search.trim(),
											path: "tags",
											fuzzy: { maxEdits: 1 },
											score: { boost: { value: 3 } },
										},
									},
									// Support partial matches using the dedicated autocomplete field
									{
										autocomplete: {
											query: search.trim(),
											path: "name",
											tokenOrder: "sequential",
											fuzzy: {
												maxEdits: 1,
												prefixLength: 1,
											},
											score: { boost: { value: 2 } },
										},
									},
								],
							},
							highlight: { path: ["name"] },
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

			// Add sorting
			if (sortBy === "effectivePrice") {
				pipeline.push({
					$sort: { effectivePrice: sortOrder === "desc" ? -1 : 1 },
				});
			} else if (search?.trim() && sortBy === "createdAt") {
				// Use search score for sorting when searching
				pipeline.push({
					$sort: { searchScore: -1 },
				});
			} else {
				pipeline.push({
					$sort: { [sortBy]: sortOrder === "desc" ? -1 : 1 },
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

			return reply.send({
				success: true,
				data: {
					items: items.map((item) => ({
						...item,
						highlights: item.highlights || undefined, // Include search highlights when available
					})),
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
