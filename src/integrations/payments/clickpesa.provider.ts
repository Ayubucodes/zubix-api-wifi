import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  InitiatePaymentRequest,
  InitiatePaymentResult,
  NormalizedWebhook,
  PaymentProvider,
  ProviderStatus,
} from "./payment.types.js";

/**
 * ClickPesa adapter. Documented endpoints (docs.clickpesa.com):
 *   POST {base}/generate-token                              headers: client-id, api-key
 *   POST {base}/payments/initiate-ussd-push-request         header: Authorization (token, already "Bearer ...")
 * Base URL: https://api.clickpesa.com/third-parties
 *
 * IMPORTANT, from the docs: ClickPesa has NO sandbox. API access needs approved KYC, and every
 * call hits production. Do not run payment tests against this adapter with real customers.
 *
 * ClickPesa also documents GET {base}/payments/{orderReference} for payment reconciliation.
 * Webhooks are still the primary mechanism for timely status updates.
 */

export interface ClickPesaConfig {
  baseUrl: string;
  clientId: string;
  apiKey: string;
  /** Secret used for the HMAC-SHA256 checksum. Set only if checksum is enabled on the account. */
  checksumSecret?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const TOKEN_TTL_MS = 50 * 60 * 1000; // token is valid for 1 hour; refresh early

export class ClickPesaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ClickPesaError";
  }
}

export class ClickPesaProvider implements PaymentProvider {
  readonly code = "CLICKPESA" as const;
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly config: ClickPesaConfig) {
    this.fetchImpl = (config.fetchImpl ?? globalThis.fetch).bind(globalThis);
    this.now = config.now ?? (() => Date.now());
  }

  /** Tokens are cached. The docs rate-limit token generation to one per client ID per IP every 3 minutes. */
  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) {
      return this.token.value;
    }
    const response = await this.fetchImpl(`${this.config.baseUrl}/generate-token`, {
      method: "POST",
      headers: { "client-id": this.config.clientId, "api-key": this.config.apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean; token?: string };
    if (!response.ok || !body.success || !body.token) {
      throw new ClickPesaError("ClickPesa token request failed", response.status);
    }
    this.token = { value: body.token, expiresAt: this.now() + TOKEN_TTL_MS };
    return body.token;
  }

  async initiatePayment(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    if (!/^[A-Za-z0-9]{1,20}$/.test(request.reference)) {
      throw new ClickPesaError("Order reference must be alphanumeric and at most 20 characters");
    }
    const payload: Record<string, unknown> = {
      amount: String(request.amountTzs),
      currency: "TZS",
      orderReference: request.reference,
      phoneNumber: request.phoneNumber,
    };
    if (this.config.checksumSecret) {
      payload.checksum = this.sign(payload);
    }

    const response = await this.fetchImpl(`${this.config.baseUrl}/payments/initiate-ussd-push-request`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: await this.getToken() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      message?: unknown;
    };
    if (!response.ok || !body.id) {
      const providerMessage = getInitiationErrorMessage(body.message);
      const reason = response.ok ? "unexpected response" : `HTTP ${response.status}`;
      throw new ClickPesaError(
        `ClickPesa rejected the USSD push request (${reason})${providerMessage ? `: ${providerMessage}` : ""}`,
        response.status,
      );
    }
    return { providerTransactionId: body.id, status: mapStatus(body.status) };
  }

  /**
   * Verifies the checksum from ClickPesa's Checksum article: HMAC-SHA256, lowercase hex, over
   * the payload with `checksum` and `checksumMethod` removed and keys sorted at every level.
   * Fails closed when no secret is configured.
   */
  verifyWebhook(body: Record<string, unknown>): boolean {
    if (!this.config.checksumSecret) return false;
    const received = body.checksum;
    if (typeof received !== "string") return false;
    const rest = { ...body };
    delete rest.checksum;
    delete rest.checksumMethod;
    const expected = this.sign(rest);
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseWebhook(body: Record<string, unknown>): NormalizedWebhook | null {
    if (
      (body.event !== "PAYMENT RECEIVED" && body.event !== "PAYMENT FAILED") ||
      typeof body.data !== "object" ||
      body.data === null
    ) {
      return null;
    }
    const data = body.data as Record<string, unknown>;
    const id = data.id;
    const reference = data.orderReference;
    const amount = Number(data.collectedAmount);
    const failed = body.event === "PAYMENT FAILED";
    if (
      typeof id !== "string" ||
      typeof reference !== "string" ||
      (!failed && (!Number.isInteger(amount) || typeof data.collectedCurrency !== "string"))
    ) {
      return null;
    }
    return {
      providerTransactionId: id,
      reference,
      status: failed ? "FAILED" : mapStatus(typeof data.status === "string" ? data.status : undefined),
      ...(Number.isInteger(amount) ? { amountTzs: amount } : {}),
      ...(typeof data.collectedCurrency === "string" ? { currency: data.collectedCurrency } : {}),
      failureReason:
        (typeof data.message === "string" && data.message) ||
        (typeof body.message === "string" && body.message) ||
        undefined,
    };
  }

  /** Exposed for tests and for signing outbound payloads. */
  sign(payload: Record<string, unknown>): string {
    if (!this.config.checksumSecret) {
      throw new ClickPesaError("Checksum secret is not configured");
    }
    return createHmac("sha256", this.config.checksumSecret).update(canonicalJson(payload)).digest("hex");
  }
}

/** Sorted-key compact JSON, recursively, as described in ClickPesa's checksum documentation. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function mapStatus(raw: string | undefined): ProviderStatus {
  switch (raw) {
    case "SUCCESS":
    case "SETTLED":
      return "SUCCESS";
    case "FAILED":
      return "FAILED";
    case "PROCESSING":
      return "PROCESSING";
    default:
      return "PENDING";
  }
}

function getInitiationErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(api[-_ ]?key|secret|token|password)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\b(?:\+?255)?\d{9,12}\b/g, "[redacted phone]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
  return message ? message.slice(0, 240) : undefined;
}
