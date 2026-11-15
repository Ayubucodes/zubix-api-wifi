import type { RoleName } from "@prisma/client";

/** Every permission code the API understands. Add new codes here and in the seed. */
export const PERMISSIONS = [
  "users:read",
  "users:manage",
  "roles:manage",
  "customers:read",
  "customers:manage",
  "packages:read",
  "packages:manage",
  "locations:read",
  "locations:manage",
  "payments:read",
  "payments:reconcile",
  "vouchers:read",
  "vouchers:manage",
  "vouchers:sell",
  "vouchers:redeem",
  "subscriptions:read",
  "subscriptions:manage",
  "network:read",
  "network:manage",
  "reports:read",
  "settings:manage",
  "audit:read",
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

const MANAGER_PERMISSIONS: PermissionCode[] = [
  "customers:read",
  "customers:manage",
  "packages:read",
  "packages:manage",
  "locations:read",
  "locations:manage",
  "payments:read",
  "vouchers:read",
  "vouchers:manage",
  "subscriptions:read",
  "subscriptions:manage",
  "network:read",
  "network:manage",
  "reports:read",
  "audit:read",
];

/** Default permission sets per role. SUPER_ADMIN receives every permission. */
export const ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  SUPER_ADMIN: [...PERMISSIONS],
  ADMIN: PERMISSIONS.filter((code) => code !== "roles:manage"),
  MANAGER: MANAGER_PERMISSIONS,
  CASHIER: ["vouchers:read", "vouchers:sell", "customers:read", "payments:read"],
  SUPPORT: [
    "customers:read",
    "customers:manage",
    "subscriptions:read",
    "network:read",
    "payments:read",
  ],
};
