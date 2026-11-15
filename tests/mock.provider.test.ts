import { describe, expect, it } from "vitest";
import { assertMockProviderAllowed, MockProvider } from "../src/integrations/payments/mock.provider.js";

describe("MockProvider", () => {
  const provider = new MockProvider("dev-secret");

  it("signs and verifies webhooks, and rejects tampering", () => {
    const body = provider.buildWebhook({ providerTransactionId: "MOCK-1", reference: "ZBX1", status: "SUCCESS", amountTzs: 500 });
    expect(provider.verifyWebhook(body)).toBe(true);
    expect(provider.verifyWebhook({ ...body, amountTzs: 5000 })).toBe(false);
    expect(provider.verifyWebhook({ ...body, mockSignature: "forged" })).toBe(false);
  });

  it("does not embed the secret in the webhook body", () => {
    const body = provider.buildWebhook({ providerTransactionId: "MOCK-1", reference: "ZBX1", status: "SUCCESS", amountTzs: 500 });
    expect(JSON.stringify(body)).not.toContain("dev-secret");
  });

  it("refuses to run in production", () => {
    expect(() => assertMockProviderAllowed("production")).toThrow();
    expect(() => assertMockProviderAllowed("development")).not.toThrow();
  });
});
