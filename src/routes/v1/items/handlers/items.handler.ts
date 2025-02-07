// src/routes/v1/items/handlers/item.handler.ts
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { IItem, Item } from "../../../../models/Item";
import { Supplier } from "../../../../models/Supplier";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

interface ItemFilters {
	search?: string;
	tags?: string | string[];
	minPrice?: number;
	maxPrice?: number;
	status?: "active" | "discontinued" | "draft";
	supplier?: string;
	minRating?: number;
	inStock?: boolean;
}

interface SortOptions {
	field: "price" | "ratings.average" | "numberOfSales" | "createdAt";
	order: "asc" | "desc";
}

export class ItemHandler {
	// Create new item
	async createItem(
		request: FastifyRequest<{ Body: Partial<IItem> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const itemData = request.body;
			Logger.debug(`Creating new item: ${itemData.name}`, "ItemHandler");

			// Validate supplier
			if (
				!mongoose.Types.ObjectId.isValid(
					itemData.supplier?.toString() || ""
				)
			) {
				throw CommonErrors.invalidFormat("supplier ID");
			}

			const supplier = await Supplier.findById(itemData.supplier).session(
				session
			);
			if (!supplier) {
				throw CommonErrors.supplierNotFound();
			}

			if (supplier.status !== "active") {
				throw createBusinessError("Supplier is not active");
			}

			// Validate variants if provided
			if (itemData.variants?.length) {
				const skus = new Set();
				for (const variant of itemData.variants) {
					if (skus.has(variant.sku)) {
						throw createBusinessError(
							`Duplicate SKU found: ${variant.sku}`
						);
					}
					skus.add(variant.sku);

					if (variant.price < 0) {
						throw createBusinessError(
							"Variant price cannot be negative"
						);
					}
				}
			}

			// Validate discount if provided
			if (itemData.discount) {
				if (itemData.discount.startDate >= itemData.discount.endDate) {
					throw createBusinessError(
						"Discount end date must be after start date"
					);
				}
				if (
					itemData.discount.percentage < 0 ||
					itemData.discount.percentage > 100
				) {
					throw createBusinessError(
						"Discount percentage must be between 0 and 100"
					);
				}
			}

			// Create item
			const item = new Item(itemData);
			await item.save({ session });

			Logger.info(
				`Item created successfully: ${item._id}`,
				"ItemHandler"
			);
			return reply.code(201).send({
				success: true,
				data: { item },
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

	// List items with filtering, sorting and pagination
	async listItems(
		request: FastifyRequest<{
			Querystring: {
				page?: number;
				limit?: number;
				sortBy?: SortOptions["field"];
				sortOrder?: SortOptions["order"];
			} & ItemFilters;
		}>,
		reply: FastifyReply
	) {
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

		// Build query
		const query: any = {};

		// Text search
		if (search) {
			query.$text = { $search: search };
		}

		// Tags filter
		if (tags) {
			if (Array.isArray(tags)) {
				query.tags = { $all: tags };
			} else {
				query.tags = { $all: tags.split(",") };
			}
		}

		// Price range
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

		// Validate sort field
		const sortField = sortBy as SortOptions["field"];
		if (
			![
				"price",
				"ratings.average",
				"numberOfSales",
				"createdAt",
			].includes(sortField)
		) {
			throw CommonErrors.invalidFormat("sort field");
		}

		try {
			const [items, total] = await Promise.all([
				Item.find(query)
					.sort({ [sortField]: sortOrder === "desc" ? -1 : 1 })
					.skip((page - 1) * limit)
					.limit(limit)
					.populate("supplier", "name code status"),
				Item.countDocuments(query),
			]);

			const totalPages = Math.ceil(total / limit);

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
			throw CommonErrors.databaseError("item retrieval");
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
