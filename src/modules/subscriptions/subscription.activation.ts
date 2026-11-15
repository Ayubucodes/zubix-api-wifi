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
 * Creates an ACTIVE subscription and applies the stacking policy. Must be called inside the
 * same transaction that claims the payment or voucher, so activation and claim succeed or fail together.
 *
 * Network authorization (Omada) is NOT done here: the device MAC is not known from a payment
 * alone. That step belongs to the captive portal flow, which is not built yet.
 */
export async function activateSubscription(tx: Tx, input: ActivationInput) {
  const now = input.now ?? new Date();
  const locationId = await resolvePackageLocation(tx, input.packageId);

  const current = await tx.subscription.findFirst({
    where: {
      customerId: input.customerId,
      locationId,
      status: "ACTIVE",
      expiresAt: { gt: now },
    },
    orderBy: { expiresAt: "desc" },
    select: { expiresAt: true },
  });

  const window = computeSubscriptionWindow({
    now,
    currentExpiresAt: current?.expiresAt ?? null,
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
      reason: window.stacked ? "Activated, stacked after existing time" : "Activated",
    },
  });

  return { subscription, stacked: window.stacked };
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
