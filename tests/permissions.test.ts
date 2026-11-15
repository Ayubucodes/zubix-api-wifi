import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../src/common/permissions.js";

describe("role permission mapping", () => {
  it("gives SUPER_ADMIN every permission", () => {
    expect(new Set(ROLE_PERMISSIONS.SUPER_ADMIN)).toEqual(new Set(PERMISSIONS));
  });

  it("does not let ADMIN manage roles", () => {
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain("roles:manage");
  });

  it("limits CASHIER to voucher sales and read access", () => {
    expect(ROLE_PERMISSIONS.CASHIER).toContain("vouchers:sell");
    expect(ROLE_PERMISSIONS.CASHIER).not.toContain("packages:manage");
    expect(ROLE_PERMISSIONS.CASHIER).not.toContain("users:manage");
  });

  it("only references defined permission codes", () => {
    const known = new Set<string>(PERMISSIONS);
    for (const codes of Object.values(ROLE_PERMISSIONS)) {
      for (const code of codes) {
        expect(known.has(code)).toBe(true);
      }
    }
  });
});
