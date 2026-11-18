import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../common/errors.js";
import { computeSubscriptionWindow, durationToMs, type DurationUnit } from "./subscription-policy.js";

type Tx = Prisma.TransactionClient | PrismaClient;

export interface ActivationInput {
  customerId: string;
  packageId: string;
  durationValue: number;
  durationUnit: DurationUnit;
  sourceType: "PAYMENT" | "VOUCHER";
  paymentId?: string;
  voucherId?: string;
  now?: Date;
}

/**
 * Creates an ACTIVE subscription for exactly the package duration. Must be called inside the same
 * transaction that claims the payment or voucher, so activation and claim succeed or fail together.
 */
export async function activateSubscription(tx: Tx, input: ActivationInput) {
  const now = input.now ?? new Date();
  const locationId = await resolvePackageLocation(tx, input.packageId);

  const window = computeSubscriptionWindow({
    now,
    durationMs: durationToMs(input.durationValue, input.durationUnit),
  });

  const subscription = await tx.subscription.create({
    data: {
      customerId: input.customerId,
      packageId: input.packageId,
      locationId,
      paymentId: input.paymentId ?? null,
      voucherId: input.voucherId ?? null,
      sourceType: input.sourceType,
      status: "ACTIVE",
      startsAt: window.startsAt,
      expiresAt: window.expiresAt,
    },
  });

  await tx.subscriptionHistory.create({
    data: {
      subscriptionId: subscription.id,
      fromStatus: null,
      toStatus: "ACTIVE",
      reason: "Activated",
    },
  });

  return { subscription };
}

/** Uses the package's first linked location, otherwise the first active location. */
export async function resolvePackageLocation(tx: Tx, packageId: string): Promise<string> {
  const linked = await tx.packageLocation.findFirst({
    where: { packageId },
    select: { locationId: true },
  });
  if (linked) return linked.locationId;

  const fallback = await tx.location.findFirst({ where: { isActive: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!fallback) {
    throw AppError.conflict("No active location exists. Create a location before selling packages.");
  }
  return fallback.id;
}
