// src/routes/v1/items/handlers/item.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { IItem, Item, IVariant } from "../../../../models/Item";
import { Supplier } from "../../../../models/Supplier";
import { BulkCreateItemBody } from "../../../../schemas/items";
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
		// Validate base price
		if (item.basePrice !== undefined && !validateVNDPrice(item.basePrice)) {
			throw createBusinessError(
				`Base price (${formatVNDPrice(
					item.basePrice
				)}) is invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
					CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
					CURRENCY_CONSTANTS.ITEM.MAX_PRICE
				)}`
			);
		}

		// Validate variant prices
		if (item.variants) {
			item.variants.forEach((variant, index) => {
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
		basePrice: number,
		variants: IVariant[],
		discountPercentage: number
	): void {
		// Validate that discounted prices will still be valid VND amounts
		const validateDiscountedPrice = (originalPrice: number) => {
			const discountedPrice = Math.round(
				originalPrice * (1 - discountPercentage / 100)
			);
			if (!validateVNDPrice(discountedPrice)) {
				throw createBusinessError(
					`Discounted price (${formatVNDPrice(
						discountedPrice
					)}) would be invalid. ${CURRENCY_CONSTANTS.ERRORS.INVALID_PRICE_RANGE(
						CURRENCY_CONSTANTS.ITEM.MIN_PRICE,
						CURRENCY_CONSTANTS.ITEM.MAX_PRICE
					)}`
				);
			}
		};

		// Check base price
		validateDiscountedPrice(basePrice);

		// Check all variant prices
		variants.forEach((variant) => {
			validateDiscountedPrice(variant.price);
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
					// Validate prices before other validations
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
								itemData.basePrice,
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

	// Update item
	async updateItem(
		request: FastifyRequest<{
			Params: { itemId: string };
			Body: Partial<IItem>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { itemId } = request.params;
			const updateData = request.body;

			if (!mongoose.Types.ObjectId.isValid(itemId)) {
				throw CommonErrors.invalidFormat("item ID");
			}

			// Get current item data for complete validation
			const currentItem = await Item.findById(itemId).session(session);
			if (!currentItem) {
				throw CommonErrors.itemNotFound();
			}

			// Check supplier if it's being updated
			if (updateData.supplier) {
				const supplier = await Supplier.findById(
					updateData.supplier
				).session(session);
				if (!supplier) {
					throw CommonErrors.supplierNotFound();
				}
				if (supplier.status !== "active") {
					throw createBusinessError("Supplier is not active");
				}
			}

			// Merge current and update data for validation
			const itemToValidate = {
				...currentItem.toObject(),
				...updateData,
				variants: updateData.variants || currentItem.variants,
			};

			// Validate prices if they're being updated
			if (updateData.basePrice !== undefined || updateData.variants) {
				ItemHandler.validateItemPrices(itemToValidate);
			}

			// Validate variants if being updated
			if (updateData.variants) {
				const skus = new Set<string>();
				for (const variant of updateData.variants) {
					if (skus.has(variant.sku)) {
						throw createBusinessError(
							`Duplicate SKU found: ${variant.sku}`
						);
					}
					skus.add(variant.sku);
				}
			}

			// Validate discount if being updated
			if (updateData.discount) {
				// First validate discount structure and dates
				ItemHandler.validateDiscount(updateData.discount);

				// Validate the resulting prices if discount is or will be active
				if (updateData.discount.active) {
					ItemHandler.validateDiscountedPrices(
						itemToValidate.basePrice,
						itemToValidate.variants,
						updateData.discount.percentage
					);
				}
			}

			const item = await Item.findByIdAndUpdate(
				itemId,
				{ $set: updateData },
				{ new: true, runValidators: true, session }
			);

			if (!item) {
				throw CommonErrors.itemNotFound();
			}

			Logger.info(`Item updated successfully: ${itemId}`, "ItemHandler");
			return reply.send({
				success: true,
				data: { item },
			});
		}, "ItemHandler");
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

			// Create initial pipeline stages array
			const pipeline: mongoose.PipelineStage[] = [];

			// Handle text search first if it exists
			if (search?.trim()) {
				pipeline.push(
					{
						$match: {
							$text: {
								$search: search.trim(),
								$caseSensitive: false,
								$diacriticSensitive: false,
							},
						},
					},
					{
						$addFields: {
							score: { $meta: "textScore" },
						},
					}
				);
			}

			// Add other filters
			const filters: mongoose.FilterQuery<IItem> = {};

			// Tags filter with validation
			if (tags) {
				const tagArray = Array.isArray(tags)
					? tags
					: tags
							.split(",")
							.map((tag) => tag.trim())
							.filter(Boolean);
				if (tagArray.length > 0) {
					filters.tags = { $all: tagArray };
				}
			}

			// Price range filter with validation
			if (minPrice !== undefined || maxPrice !== undefined) {
				filters.basePrice = {};
				if (minPrice !== undefined && minPrice >= 0) {
					filters.basePrice.$gte = minPrice;
				}
				if (maxPrice !== undefined && maxPrice >= 0) {
					filters.basePrice.$lte = maxPrice;
				}
			}

			// Status filter
			if (status) {
				filters.status = status;
			}

			// Supplier filter with validation
			if (supplier) {
				if (!mongoose.Types.ObjectId.isValid(supplier)) {
					throw CommonErrors.invalidFormat("supplier ID");
				}
				filters.supplier = new mongoose.Types.ObjectId(supplier);
			}

			// Rating filter with validation
			if (minRating !== undefined && minRating >= 0 && minRating <= 5) {
				filters["ratings.average"] = { $gte: minRating };
			}

			// Stock filter
			if (inStock !== undefined) {
				filters["variants"] = {
					$elemMatch: {
						stockQuantity: inStock ? { $gt: 0 } : 0,
					},
				};
			}

			// Add non-text filters if they exist
			if (Object.keys(filters).length > 0) {
				pipeline.push({ $match: filters });
			}

			// Add effective price calculation
			pipeline.push({
				$addFields: {
					effectivePrice: {
						$cond: {
							if: {
								$and: [
									{ $eq: ["$discount.active", true] },
									{ $gt: ["$discount.percentage", 0] },
									{ $lt: ["$discount.percentage", 100] },
								],
							},
							then: {
								$multiply: [
									"$basePrice",
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
							else: "$basePrice",
						},
					},
				},
			});

			// Add sorting
			const sortStage: { $sort: Record<string, 1 | -1> } = {
				$sort: {},
			};

			if (search?.trim() && sortBy === "createdAt") {
				sortStage.$sort = { score: -1 };
			} else if (sortBy === "effectivePrice") {
				sortStage.$sort = {
					effectivePrice: sortOrder === "desc" ? -1 : 1,
				};
			} else {
				sortStage.$sort = { [sortBy]: sortOrder === "desc" ? -1 : 1 };
			}

			pipeline.push(sortStage);

			// Add pagination
			pipeline.push(
				{ $skip: (validatedPage - 1) * validatedLimit },
				{ $limit: validatedLimit }
			);

			// Execute query with proper count
			const [items, totalDocs] = await Promise.all([
				Item.aggregate(pipeline),
				search?.trim()
					? Item.countDocuments({
							$text: { $search: search.trim() },
							...filters,
					  })
					: Item.countDocuments(filters),
			]);

			// Calculate pagination metadata
			const totalPages = Math.ceil(totalDocs / validatedLimit);

			// Validate requested page number
			if (validatedPage > totalPages && totalDocs > 0) {
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
					items,
					pagination: {
						total: totalDocs,
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
