import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { InitiatePaymentRequest, InitiatePaymentResult, NormalizedWebhook, PaymentProvider } from "./payment.types.js";

/**
 * Development-only provider. It never moves money. It is refused in production
 * (see assertMockProviderAllowed), so it cannot activate subscriptions for real customers.
 *
 * Its webhooks are signed with HMAC-SHA256 using a local secret, so the same verification
 * path runs in tests and local development.
 */
export class MockProvider implements PaymentProvider {
  readonly code = "MOCK" as const;

  constructor(private readonly secret: string) {}

  async initiatePayment(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    return { providerTransactionId: `MOCK-${request.reference}-${randomUUID().slice(0, 8)}`, status: "PROCESSING" };
  }

  verifyWebhook(body: Record<string, unknown>): boolean {
    const received = body.mockSignature;
    if (typeof received !== "string") return false;
    const expected = Buffer.from(this.sign(body));
    const actual = Buffer.from(received);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  parseWebhook(body: Record<string, unknown>): NormalizedWebhook | null {
    if (body.event !== "MOCK_PAYMENT") return null;
    if (typeof body.providerTransactionId !== "string" || typeof body.reference !== "string") return null;
    const status = body.status === "SUCCESS" || body.status === "FAILED" ? body.status : "PROCESSING";
    return {
      providerTransactionId: body.providerTransactionId,
      reference: body.reference,
      status,
      amountTzs: Number(body.amountTzs),
      currency: "TZS",
      failureReason: typeof body.failureReason === "string" ? body.failureReason : undefined,
    };
  }

  /** Builds a signed mock webhook body, for development scripts and tests. */
  buildWebhook(fields: Record<string, unknown>): Record<string, unknown> {
    const body: Record<string, unknown> = { event: "MOCK_PAYMENT", ...fields };
    body.mockSignature = this.sign(body);
    return body;
  }

  private sign(body: Record<string, unknown>): string {
    const { mockSignature: _ignored, ...rest } = body;
    const canonical = JSON.stringify(rest, Object.keys(rest).sort());
    return createHmac("sha256", this.secret).update(canonical).digest("hex");
  }
}

export function assertMockProviderAllowed(appEnv: string): void {
  if (appEnv === "production") {
    throw new Error("The MOCK payment provider cannot be enabled when APP_ENV=production");
  }
}
