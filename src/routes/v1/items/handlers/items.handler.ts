// src/routes/v1/items/handlers/item.handler.ts
import { Static } from "@sinclair/typebox";
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { IItem, Item } from "../../../../models/Item";
import { Supplier } from "../../../../models/Supplier";
import { BulkCreateItemBody } from "../../../../schemas/items";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

export class ItemHandler {
	// Search items
	private buildSearchQuery(searchTerm: string) {
		// Handle exact phrase matches (terms in quotes)
		const exactPhrases =
			searchTerm.match(/"([^"]+)"/g)?.map((p) => p.slice(1, -1)) || [];
		const remainingTerms = searchTerm
			.replace(/"([^"]+)"/g, "")
			.trim()
			.split(/\s+/)
			.filter(Boolean);

		// Combine exact phrases and fuzzy terms
		const searchTerms = [
			...exactPhrases.map((phrase) => `"${phrase}"`),
			...remainingTerms.map((term) => {
				// Add fuzzy matching for terms longer than 3 characters
				return term.length > 3
					? `${term}|${term.replace(/[aeiou]/g, ".")}`
					: term;
			}),
		].join(" ");

		return {
			$text: {
				$search: searchTerms,
				$caseSensitive: false,
				$diacriticSensitive: false,
			},
		};
	}

	// Add score field to query
	private addScoreField(query: any, searchTerm: string | undefined) {
		if (!searchTerm) return query;

		return {
			...query,
			score: { $meta: "textScore" },
		};
	}

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

	// Create new item
	async createItem(
		request: FastifyRequest<{ Body: Partial<IItem> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const itemData = request.body;
			Logger.debug(`Creating new item: ${itemData.name}`, "ItemHandler");

			try {
				// Changed this.validateSupplier to ItemHandler.validateSupplier
				await ItemHandler.validateSupplier(
					itemData.supplier?.toString() || "",
					session
				);

				// Similarly change other validation calls
				const allSkus = new Set<string>();
				ItemHandler.validateVariants(itemData.variants || [], allSkus);
				ItemHandler.validateDiscount(itemData.discount);

				// Rest of your code remains the same
				const preparedItem = {
					...itemData,
					discount: itemData.discount
						? {
								...itemData.discount,
								startDate: new Date(
									itemData.discount.startDate
								),
								endDate: new Date(itemData.discount.endDate),
						  }
						: undefined,
				};

				const item = new Item(preparedItem);
				await item.save({ session });

				Logger.info(
					`Item created successfully: ${item._id}`,
					"ItemHandler"
				);

				return reply.code(201).send({
					success: true,
					data: { item },
				});
			} catch (error) {
				Logger.error(error as Error, "ItemHandler");

				if (error instanceof mongoose.Error.ValidationError) {
					throw createBusinessError(
						`Validation error: ${error.message}`
					);
				}

				if (error instanceof mongoose.Error) {
					throw CommonErrors.databaseError("item creation");
				}

				throw error;
			}
		}, "ItemHandler");
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
					// Validate each item sequentially
					await ItemHandler.validateSupplier(
						itemData.supplier?.toString(),
						session
					);

					ItemHandler.validateVariants(itemData.variants, allSkus);
					ItemHandler.validateDiscount(itemData.discount);

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

			// Validate variants if being updated
			if (updateData.variants) {
				const skus = new Set();
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
				const now = new Date();
				if (
					updateData.discount.startDate >= updateData.discount.endDate
				) {
					throw createBusinessError(
						"Discount end date must be after start date"
					);
				}
				if (
					updateData.discount.startDate < now &&
					updateData.discount.active
				) {
					throw createBusinessError(
						"Cannot update an active discount"
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
				sortBy?:
					| "price"
					| "ratings.average"
					| "numberOfSales"
					| "createdAt";
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

			// Validate pagination parameters
			if (page < 1 || limit < 1 || limit > 100) {
				throw CommonErrors.invalidFormat("pagination parameters");
			}

			// Build base query
			const query: any = {};

			// Add text search if provided
			if (search?.trim()) {
				Object.assign(query, this.buildSearchQuery(search.trim()));
			}

			// Tags filter
			if (tags) {
				query.tags = Array.isArray(tags)
					? { $all: tags }
					: { $all: tags.split(",") };
			}

			// Price range filter
			if (minPrice !== undefined || maxPrice !== undefined) {
				query.basePrice = {};
				if (minPrice !== undefined) query.basePrice.$gte = minPrice;
				if (maxPrice !== undefined) query.basePrice.$lte = maxPrice;
			}

			// Status filter
			if (status) {
				query.status = status;
			}

			// Supplier filter
			if (supplier) {
				if (!mongoose.Types.ObjectId.isValid(supplier)) {
					throw CommonErrors.invalidFormat("supplier ID");
				}
				query.supplier = supplier;
			}

			// Rating filter
			if (minRating !== undefined) {
				query["ratings.average"] = { $gte: minRating };
			}

			// Stock filter
			if (inStock !== undefined) {
				query["variants.stockQuantity"] = inStock ? { $gt: 0 } : 0;
			}

			// Build sort options
			let sortOptions: any = {};

			// If there's a text search, prioritize text score unless specific sort is requested
			if (search?.trim() && sortBy === "createdAt") {
				sortOptions = { score: { $meta: "textScore" } };
			} else {
				sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;
			}

			// Execute query with pagination
			const [items, total] = await Promise.all([
				Item.find(this.addScoreField(query, search))
					.sort(sortOptions)
					.skip((page - 1) * limit)
					.limit(limit)
					.populate("supplier", "name code status")
					.lean(),
				Item.countDocuments(query),
			]);

			const totalPages = Math.ceil(total / limit);

			// Validate requested page number
			if (page > totalPages && total > 0) {
				throw CommonErrors.invalidFormat(
					`Page ${page} exceeds available pages (${totalPages})`
				);
			}

			Logger.debug(
				`Retrieved ${items.length} items (page ${page} of ${totalPages})`,
				"ItemHandler"
			);

			return reply.send({
				success: true,
				data: {
					items,
					pagination: {
						total,
						page,
						totalPages,
						hasNext: page < totalPages,
						hasPrev: page > 1,
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
