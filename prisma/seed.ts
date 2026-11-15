import { randomBytes } from "node:crypto";
import { PrismaClient, PaymentProviderCode, PackageDurationUnit, RoleName } from "@prisma/client";
import { hashPassword } from "../src/common/crypto.js";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/common/permissions.js";

/**
 * Idempotent seed: safe to run repeatedly. It never overwrites an existing administrator
 * password. If SEED_ADMIN_PASSWORD is not set, a random one is generated and printed once.
 */
const prisma = new PrismaClient();

async function seedPermissionsAndRoles(): Promise<void> {
  for (const code of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code.replace(":", " ") },
    });
  }

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName, description: roleName.replace("_", " ").toLowerCase() },
    });

    const codes = ROLE_PERMISSIONS[roleName];
    const permissions = await prisma.permission.findMany({ where: { code: { in: codes } } });
    for (const permission of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }
}

async function seedAdministrator(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@zubix.local").trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Administrator ${email} already exists. Password not changed.`);
    return;
  }

  const providedPassword = process.env.SEED_ADMIN_PASSWORD?.trim();
  const password = providedPassword || randomBytes(18).toString("base64url");
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  }

  const user = await prisma.user.create({
    data: {
      email,
      fullName: "System Administrator",
      passwordHash: await hashPassword(password),
    },
  });

  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: superAdmin.id } });

  console.log(`Created administrator ${email}`);
  if (!providedPassword) {
    console.log(`Generated password (shown once, store it now): ${password}`);
  }
}

async function seedPaymentProviders(): Promise<void> {
  const providers: Array<{ code: PaymentProviderCode; name: string; isEnabled: boolean }> = [
    { code: PaymentProviderCode.MOCK, name: "Mock (development only)", isEnabled: process.env.APP_ENV !== "production" },
    { code: PaymentProviderCode.SELCOM, name: "Selcom", isEnabled: false },
    { code: PaymentProviderCode.CLICKPESA, name: "ClickPesa", isEnabled: false },
  ];
  for (const provider of providers) {
    await prisma.paymentProvider.upsert({
      where: { code: provider.code },
      update: {},
      create: provider,
    });
  }
}

async function seedLocationsAndPackages(): Promise<void> {
  const location = await prisma.location.upsert({
    where: { code: "DSM-HQ" },
    update: {},
    create: {
      name: "Dar es Salaam - Head Office",
      code: "DSM-HQ",
      address: "Dar es Salaam, Tanzania",
      timezone: "Africa/Dar_es_Salaam",
    },
  });

  const samples: Array<{
    name: string;
    durationValue: number;
    durationUnit: PackageDurationUnit;
    priceTzs: number;
    maxDevices: number;
  }> = [
    { name: "1 Hour", durationValue: 1, durationUnit: PackageDurationUnit.HOUR, priceTzs: 500, maxDevices: 1 },
    { name: "1 Day", durationValue: 1, durationUnit: PackageDurationUnit.DAY, priceTzs: 2000, maxDevices: 1 },
    { name: "7 Days", durationValue: 7, durationUnit: PackageDurationUnit.DAY, priceTzs: 10000, maxDevices: 2 },
  ];

  for (const sample of samples) {
    const existing = await prisma.package.findFirst({ where: { name: sample.name } });
    if (existing) {
      continue;
    }
    const created = await prisma.package.create({
      data: { ...sample, prices: { create: { amountTzs: sample.priceTzs } } },
    });
    await prisma.packageLocation.create({
      data: { packageId: created.id, locationId: location.id },
    });
  }
}

async function main(): Promise<void> {
  await seedPermissionsAndRoles();
  await seedAdministrator();
  await seedPaymentProviders();
  await seedLocationsAndPackages();
  console.log("Seed complete.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
