// src/routes/v1/suppliers/handlers/suppliers.handler.ts
import { FastifyReply, FastifyRequest } from "fastify";
import mongoose from "mongoose";
import { Item } from "../../../../models/Item";
import { ISupplier, Supplier } from "../../../../models/Supplier";
import { Logger } from "../../../../services/logger.service";
import {
	CommonErrors,
	createBusinessError,
} from "../../../../utils/error-handler";
import { withTransaction } from "../../../../utils/transaction.utils";

interface SupplierFilters {
	search?: string;
	status?: "active" | "inactive" | "blacklisted";
	tags?: string | string[];
	minRating?: number;
	country?: string;
}

interface SortOptions {
	field: "name" | "rating" | "leadTime" | "createdAt";
	order: "asc" | "desc";
}

export class SupplierHandler {
	// Create new supplier
	async createSupplier(
		request: FastifyRequest<{ Body: Partial<ISupplier> }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const supplierData = request.body;
			Logger.debug(
				`Creating new supplier: ${supplierData.name}`,
				"SupplierHandler"
			);

			// Check for duplicate supplier code
			const existingSupplier = await Supplier.findOne({
				code: supplierData.code,
			}).session(session);
			if (existingSupplier) {
				throw createBusinessError("Supplier code already exists");
			}

			// Validate contract dates
			if (
				supplierData.contractEndDate &&
				supplierData.contractStartDate
			) {
				const startDate = new Date(supplierData.contractStartDate);
				const endDate = new Date(supplierData.contractEndDate);
				if (endDate <= startDate) {
					throw createBusinessError(
						"Contract end date must be after start date"
					);
				}
			}

			const supplier = new Supplier(supplierData);
			await supplier.save({ session });

			Logger.info(
				`Supplier created successfully: ${supplier._id}`,
				"SupplierHandler"
			);
			return reply.code(201).send({
				success: true,
				data: { supplier },
			});
		}, "SupplierHandler");
	}

	// Get supplier by ID
	async getSupplier(
		request: FastifyRequest<{ Params: { supplierId: string } }>,
		reply: FastifyReply
	) {
		const { supplierId } = request.params;

		if (!mongoose.Types.ObjectId.isValid(supplierId)) {
			throw CommonErrors.invalidFormat("supplier ID");
		}

		const supplier = await Supplier.findById(supplierId);
		if (!supplier) {
			throw CommonErrors.supplierNotFound();
		}

		return reply.send({
			success: true,
			data: { supplier },
		});
	}

	// Update supplier
	async updateSupplier(
		request: FastifyRequest<{
			Params: { supplierId: string };
			Body: Partial<ISupplier>;
		}>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { supplierId } = request.params;
			const updateData = request.body;

			if (!mongoose.Types.ObjectId.isValid(supplierId)) {
				throw CommonErrors.invalidFormat("supplier ID");
			}

			// Check for duplicate code if being updated
			if (updateData.code) {
				const existingSupplier = await Supplier.findOne({
					code: updateData.code,
					_id: { $ne: supplierId },
				}).session(session);
				if (existingSupplier) {
					throw createBusinessError("Supplier code already exists");
				}
			}

			// Validate contract dates if being updated
			if (updateData.contractEndDate || updateData.contractStartDate) {
				const supplier = await Supplier.findById(supplierId).session(
					session
				);
				if (!supplier) {
					throw CommonErrors.supplierNotFound();
				}

				const startDate = updateData.contractStartDate
					? new Date(updateData.contractStartDate)
					: supplier.contractStartDate;
				const endDate = updateData.contractEndDate
					? new Date(updateData.contractEndDate)
					: supplier.contractEndDate;

				if (endDate && startDate && endDate <= startDate) {
					throw createBusinessError(
						"Contract end date must be after start date"
					);
				}
			}

			const supplier = await Supplier.findByIdAndUpdate(
				supplierId,
				{ $set: updateData },
				{ new: true, runValidators: true, session }
			);

			if (!supplier) {
				throw CommonErrors.supplierNotFound();
			}

			Logger.info(
				`Supplier updated successfully: ${supplierId}`,
				"SupplierHandler"
			);
			return reply.send({
				success: true,
				data: { supplier },
			});
		}, "SupplierHandler");
	}

	// Delete supplier
	async deleteSupplier(
		request: FastifyRequest<{ Params: { supplierId: string } }>,
		reply: FastifyReply
	) {
		return withTransaction(async (session) => {
			const { supplierId } = request.params;

			if (!mongoose.Types.ObjectId.isValid(supplierId)) {
				throw CommonErrors.invalidFormat("supplier ID");
			}

			// Check for associated items
			const associatedItems = await Item.countDocuments({
				supplier: supplierId,
			}).session(session);
			if (associatedItems > 0) {
				// Instead of deleting, mark as inactive
				const supplier = await Supplier.findByIdAndUpdate(
					supplierId,
					{ status: "inactive" },
					{ new: true, session }
				);

				if (!supplier) {
					throw CommonErrors.supplierNotFound();
				}

				Logger.info(
					`Supplier marked as inactive: ${supplierId}`,
					"SupplierHandler"
				);
				return reply.send({
					success: true,
					data: {
						message:
							"Supplier marked as inactive due to existing items",
						supplier,
					},
				});
			}

			const supplier = await Supplier.findByIdAndDelete(
				supplierId
			).session(session);
			if (!supplier) {
				throw CommonErrors.supplierNotFound();
			}

			Logger.info(
				`Supplier deleted successfully: ${supplierId}`,
				"SupplierHandler"
			);
			return reply.send({
				success: true,
				data: { message: "Supplier deleted successfully" },
			});
		}, "SupplierHandler");
	}

	// List suppliers with filtering and pagination
	async listSuppliers(
		request: FastifyRequest<{
			Querystring: {
				page?: number;
				limit?: number;
				sortBy?: SortOptions["field"];
				sortOrder?: SortOptions["order"];
			} & SupplierFilters;
		}>,
		reply: FastifyReply
	) {
		const {
			page = 1,
			limit = 10,
			search,
			status,
			tags,
			minRating,
			country,
			sortBy = "createdAt",
			sortOrder = "desc",
		} = request.query;

		// Build query
		const query: any = {};

		// Text search
		if (search) {
			query.$text = { $search: search };
		}

		// Status filter
		if (status) {
			query.status = status;
		}

		// Tags filter
		if (tags) {
			if (Array.isArray(tags)) {
				query.tags = { $all: tags };
			} else {
				query.tags = { $all: tags.split(",") };
			}
		}

		// Rating filter
		if (minRating !== undefined) {
			query.rating = { $gte: minRating };
		}

		// Country filter
		if (country) {
			query["address.country"] = country;
		}

		try {
			const [suppliers, total] = await Promise.all([
				Supplier.find(query)
					.sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
					.skip((page - 1) * limit)
					.limit(limit),
				Supplier.countDocuments(query),
			]);

			const totalPages = Math.ceil(total / limit);

			return reply.send({
				success: true,
				data: {
					suppliers,
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
			Logger.error(error as Error, "SupplierHandler");
			throw CommonErrors.databaseError("supplier retrieval");
		}
	}

	// Get supplier statistics
	async getSupplierStats(
		request: FastifyRequest<{ Params: { supplierId: string } }>,
		reply: FastifyReply
	) {
		const { supplierId } = request.params;

		if (!mongoose.Types.ObjectId.isValid(supplierId)) {
			throw CommonErrors.invalidFormat("supplier ID");
		}

		const supplier = await Supplier.findById(supplierId);
		if (!supplier) {
			throw CommonErrors.supplierNotFound();
		}

		const [totalItems, activeItems] = await Promise.all([
			Item.countDocuments({ supplier: supplierId }),
			Item.countDocuments({ supplier: supplierId, status: "active" }),
		]);

		return reply.send({
			success: true,
			data: {
				totalItems,
				activeItems,
				rating: supplier.rating,
				contractStatus:
					supplier.contractEndDate &&
					supplier.contractEndDate < new Date()
						? "expired"
						: "active",
			},
		});
	}
}
