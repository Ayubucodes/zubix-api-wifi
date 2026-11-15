import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import type { CreatePackageInput, ListPackagesQuery, UpdatePackageInput } from "./packages.schemas.js";

const packageInclude = {
  prices: { orderBy: { effectiveFrom: "desc" as const }, take: 1 },
  locations: { select: { locationId: true } },
} satisfies Prisma.PackageInclude;

export class PackagesService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(query: ListPackagesQuery) {
    const where: Prisma.PackageWhereInput = {
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.search ? { name: { contains: query.search, mode: "insensitive" } } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.package.findMany({
        where,
        include: packageInclude,
        orderBy: [{ isActive: "desc" }, { priceTzs: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.package.count({ where }),
    ]);

    return {
      items: items.map(toPackageDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id }, include: packageInclude });
    if (!pkg) throw AppError.notFound("Package not found");
    return toPackageDto(pkg);
  }

  async create(input: CreatePackageInput, actorUserId: string) {
    await this.assertLocationsExist(input.locationIds);
    const pkg = await this.prisma.$transaction(async (tx) => {
      const created = await tx.package.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          durationValue: input.durationValue,
          durationUnit: input.durationUnit,
          priceTzs: input.priceTzs,
          dataLimitMb: input.dataLimitMb ?? null,
          downloadKbps: input.downloadKbps ?? null,
          uploadKbps: input.uploadKbps ?? null,
          maxDevices: input.maxDevices,
          isActive: input.isActive,
          prices: { create: { amountTzs: input.priceTzs } },
          locations: { create: input.locationIds.map((locationId) => ({ locationId })) },
        },
      });
      await tx.auditLog.create({
        data: { actorUserId, action: "package.create", entityType: "Package", entityId: created.id },
      });
      return created;
    });
    return this.get(pkg.id);
  }

  async update(id: string, input: UpdatePackageInput, actorUserId: string) {
    const existing = await this.prisma.package.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Package not found");
    if (input.locationIds) await this.assertLocationsExist(input.locationIds);

    await this.prisma.$transaction(async (tx) => {
      const priceChanged = input.priceTzs !== undefined && input.priceTzs !== existing.priceTzs;
      await tx.package.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          durationValue: input.durationValue,
          durationUnit: input.durationUnit,
          priceTzs: input.priceTzs,
          dataLimitMb: input.dataLimitMb,
          downloadKbps: input.downloadKbps,
          uploadKbps: input.uploadKbps,
          maxDevices: input.maxDevices,
          isActive: input.isActive,
        },
      });
      if (priceChanged && input.priceTzs !== undefined) {
        // Price history is kept, so past payments still reference the price they were charged at.
        await tx.packagePrice.create({ data: { packageId: id, amountTzs: input.priceTzs } });
      }
      if (input.locationIds) {
        await tx.packageLocation.deleteMany({ where: { packageId: id } });
        await tx.packageLocation.createMany({
          data: input.locationIds.map((locationId) => ({ packageId: id, locationId })),
        });
      }
      await tx.auditLog.create({
        data: { actorUserId, action: "package.update", entityType: "Package", entityId: id },
      });
    });
    return this.get(id);
  }

  /**
   * Packages are archived, never hard-deleted, because payments and subscriptions reference them.
   */
  async archive(id: string, actorUserId: string): Promise<void> {
    const existing = await this.prisma.package.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("Package not found");
    await this.prisma.$transaction([
      this.prisma.package.update({ where: { id }, data: { isArchived: true, isActive: false } }),
      this.prisma.auditLog.create({
        data: { actorUserId, action: "package.archive", entityType: "Package", entityId: id },
      }),
    ]);
  }

  private async assertLocationsExist(locationIds: string[]): Promise<void> {
    if (locationIds.length === 0) return;
    const found = await this.prisma.location.count({ where: { id: { in: locationIds } } });
    if (found !== new Set(locationIds).size) {
      throw AppError.badRequest("One or more locations do not exist");
    }
  }
}

interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  durationValue: number;
  durationUnit: string;
  priceTzs: number;
  dataLimitMb: number | null;
  downloadKbps: number | null;
  uploadKbps: number | null;
  maxDevices: number;
  isActive: boolean;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
  locations: Array<{ locationId: string }>;
}

function toPackageDto(pkg: PackageRow) {
  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    durationValue: pkg.durationValue,
    durationUnit: pkg.durationUnit,
    priceTzs: pkg.priceTzs,
    dataLimitMb: pkg.dataLimitMb,
    downloadKbps: pkg.downloadKbps,
    uploadKbps: pkg.uploadKbps,
    maxDevices: pkg.maxDevices,
    isActive: pkg.isActive,
    isArchived: pkg.isArchived,
    locationIds: pkg.locations.map((link) => link.locationId),
    createdAt: pkg.createdAt.toISOString(),
    updatedAt: pkg.updatedAt.toISOString(),
  };
}
