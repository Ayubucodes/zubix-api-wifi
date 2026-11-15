import { z } from "zod";

const durationUnits = ["MINUTE", "HOUR", "DAY", "WEEK", "MONTH"] as const;

export const packageBaseSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  durationValue: z.number().int().positive().max(100000),
  durationUnit: z.enum(durationUnits),
  priceTzs: z.number().int().min(0).max(100_000_000),
  dataLimitMb: z.number().int().positive().nullable().optional(),
  downloadKbps: z.number().int().positive().max(10_000_000).nullable().optional(),
  uploadKbps: z.number().int().positive().max(10_000_000).nullable().optional(),
  maxDevices: z.number().int().min(1).max(20).default(1),
  isActive: z.boolean().default(true),
  locationIds: z.array(z.string().uuid()).default([]),
});

export const createPackageSchema = packageBaseSchema;
export const updatePackageSchema = packageBaseSchema.partial();

export const listPackagesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeArchived: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  search: z.string().trim().max(80).optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
export type ListPackagesQuery = z.infer<typeof listPackagesQuerySchema>;
