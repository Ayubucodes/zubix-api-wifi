import { describe, expect, it, vi } from "vitest";
import { canonicalJson, ClickPesaError, ClickPesaProvider } from "../src/integrations/payments/clickpesa.provider.js";

const SECRET = "test-checksum-secret";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("canonicalJson", () => {
  it("sorts keys at every level and produces compact JSON", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ z: 1, y: 2 }] } })).toBe('{"a":{"c":[{"y":2,"z":1}],"d":2},"b":1}');
  });
});

describe("ClickPesaProvider", () => {
  it("calls the Worker fetch function with its required global receiver", async () => {
    const receivers: unknown[] = [];
    const fetchImpl = vi.fn(async function (this: unknown, url: string | URL | Request) {
      receivers.push(this);
      return String(url).endsWith("/generate-token")
        ? jsonResponse({ success: true, token: "Bearer t" })
        : jsonResponse({ id: "TX1", status: "PROCESSING" });
    }) as unknown as typeof fetch;
    const provider = new ClickPesaProvider({
      baseUrl: "https://api.clickpesa.com/third-parties",
      clientId: "cid",
      apiKey: "key",
      fetchImpl,
    });

    await provider.initiatePayment({ reference: "ZBX1", amountTzs: 500, phoneNumber: "255712345678" });

    expect(receivers).toEqual([globalThis, globalThis]);
  });

  it("caches the token and reuses it until close to expiry", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/generate-token")) return jsonResponse({ success: true, token: "Bearer t1" });
      return jsonResponse({ id: "TX1", status: "PROCESSING" });
    }) as unknown as typeof fetch;

    const provider = new ClickPesaProvider({
      baseUrl: "https://api.clickpesa.com/third-parties",
      clientId: "cid",
      apiKey: "key",
      fetchImpl,
      now: () => now,
    });

    await provider.initiatePayment({ reference: "ZBX1", amountTzs: 500, phoneNumber: "255712345678" });
    await provider.initiatePayment({ reference: "ZBX2", amountTzs: 500, phoneNumber: "255712345678" });
    const tokenCalls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
      String(c[0]).endsWith("/generate-token"),
    );
    expect(tokenCalls).toHaveLength(1);

    now += 55 * 60 * 1000;
    await provider.initiatePayment({ reference: "ZBX3", amountTzs: 500, phoneNumber: "255712345678" });
    const tokenCallsAfter = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
      String(c[0]).endsWith("/generate-token"),
    );
    expect(tokenCallsAfter).toHaveLength(2);
  });

  it("sends the documented USSD push body with amount as a string and TZS currency", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/generate-token")) return jsonResponse({ success: true, token: "Bearer t" });
      return jsonResponse({ id: "TX9", status: "PROCESSING" });
    }) as unknown as typeof fetch;

    const provider = new ClickPesaProvider({ baseUrl: "https://api.clickpesa.com/third-parties", clientId: "c", apiKey: "k", fetchImpl });
    const result = await provider.initiatePayment({ reference: "ZBX9", amountTzs: 2000, phoneNumber: "255712345678" });

    expect(result).toEqual({ providerTransactionId: "TX9", status: "PROCESSING" });
    const call = seen.find((s) => s.url.endsWith("/payments/initiate-ussd-push-request"));
    expect(call?.init.headers).toMatchObject({ authorization: "Bearer t" });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      amount: "2000",
      currency: "TZS",
      orderReference: "ZBX9",
      phoneNumber: "255712345678",
    });
  });

  it("queries ClickPesa by order reference and normalizes its payment status", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/generate-token")) return jsonResponse({ success: true, token: "Bearer t" });
      return jsonResponse([
        {
          id: "TX12",
          orderReference: "ZBX12",
          status: "SETTLED",
          collectedAmount: "500",
          collectedCurrency: "TZS",
        },
      ]);
    }) as unknown as typeof fetch;
    const provider = new ClickPesaProvider({
      baseUrl: "https://api.clickpesa.com/third-parties",
      clientId: "c",
      apiKey: "k",
      fetchImpl,
    });

    await expect(provider.queryPaymentStatus("ZBX12")).resolves.toEqual({
      providerTransactionId: "TX12",
      reference: "ZBX12",
      status: "SUCCESS",
      amountTzs: 500,
      currency: "TZS",
    });
    const query = seen.find((call) => call.url.endsWith("/payments/ZBX12"));
    expect(query?.init.method).toBe("GET");
    expect(query?.init.headers).toMatchObject({ authorization: "Bearer t" });
  });

  it("throttles repeated status queries for the same payment", async () => {
    let now = 1_000_000;
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/generate-token")
        ? jsonResponse({ success: true, token: "Bearer t" })
        : jsonResponse([{ id: "TX12", orderReference: "ZBX12", status: "PROCESSING" }]),
    ) as unknown as typeof fetch;
    const provider = new ClickPesaProvider({
      baseUrl: "https://api.clickpesa.com/third-parties",
      clientId: "c",
      apiKey: "k",
      fetchImpl,
      now: () => now,
    });

    await provider.queryPaymentStatus("ZBX12");
    await expect(provider.queryPaymentStatus("ZBX12")).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    now += 10_000;
    await provider.queryPaymentStatus("ZBX12");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("preserves a sanitized ClickPesa initiation rejection reason", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("/generate-token")) return jsonResponse({ success: true, token: "Bearer t" });
      return jsonResponse({ message: "Checksum validation failed for 255712345678" }, 400);
    }) as unknown as typeof fetch;
    const provider = new ClickPesaProvider({
      baseUrl: "https://api.clickpesa.com/third-parties",
      clientId: "c",
      apiKey: "k",
      fetchImpl,
    });

    await expect(
      provider.initiatePayment({ reference: "ZBX9", amountTzs: 500, phoneNumber: "255712345678" }),
    ).rejects.toMatchObject({
      name: "ClickPesaError",
      status: 400,
      message: "ClickPesa rejected the USSD push request (HTTP 400): Checksum validation failed for [redacted phone]",
    });
  });

  it("refuses order references longer than 20 characters or non-alphanumeric", async () => {
    const provider = new ClickPesaProvider({ baseUrl: "x", clientId: "c", apiKey: "k", fetchImpl: vi.fn() as unknown as typeof fetch });
    await expect(provider.initiatePayment({ reference: "ZBX-1", amountTzs: 1, phoneNumber: "255712345678" })).rejects.toBeInstanceOf(
      ClickPesaError,
    );
    await expect(provider.initiatePayment({ reference: "A".repeat(21), amountTzs: 1, phoneNumber: "255712345678" })).rejects.toBeInstanceOf(
      ClickPesaError,
    );
  });

  it("verifies a webhook checksum and rejects tampered amounts", () => {
    const provider = new ClickPesaProvider({ baseUrl: "x", clientId: "c", apiKey: "k", checksumSecret: SECRET, fetchImpl: vi.fn() as unknown as typeof fetch });
    const unsigned = { event: "PAYMENT RECEIVED", data: { id: "TX1", orderReference: "ZBX1", status: "SUCCESS", collectedAmount: "500", collectedCurrency: "TZS" } };
    const signed = { ...unsigned, checksum: provider.sign(unsigned), checksumMethod: "HMAC-SHA256" };

    expect(provider.verifyWebhook(signed)).toBe(true);
    expect(provider.verifyWebhook({ ...signed, data: { ...signed.data, collectedAmount: "5000" } })).toBe(false);
    expect(provider.verifyWebhook(unsigned)).toBe(false);
  });

  it("fails closed when no checksum secret is configured", () => {
    const provider = new ClickPesaProvider({ baseUrl: "x", clientId: "c", apiKey: "k", fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(provider.verifyWebhook({ event: "PAYMENT RECEIVED", checksum: "anything" })).toBe(false);
  });

  it("parses a PAYMENT RECEIVED webhook into the normalized shape", () => {
    const provider = new ClickPesaProvider({ baseUrl: "x", clientId: "c", apiKey: "k", fetchImpl: vi.fn() as unknown as typeof fetch });
    const parsed = provider.parseWebhook({
      event: "PAYMENT RECEIVED",
      data: { id: "ORD123456LCP7890", orderReference: "ORD123456", status: "SETTLED", collectedAmount: "10000", collectedCurrency: "TZS" },
    });
    expect(parsed).toEqual({
      providerTransactionId: "ORD123456LCP7890",
      reference: "ORD123456",
      status: "SUCCESS",
      amountTzs: 10000,
      currency: "TZS",
      failureReason: undefined,
    });
  });

  it("parses ClickPesa's PAYMENT FAILED webhook without an amount", () => {
    const provider = new ClickPesaProvider({ baseUrl: "x", clientId: "c", apiKey: "k", fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(
      provider.parseWebhook({
        event: "PAYMENT FAILED",
        data: { id: "ORD123456LCP7890", orderReference: "ORD123456", status: "FAILED", message: "Insufficient balance" },
      }),
    ).toEqual({
      providerTransactionId: "ORD123456LCP7890",
      reference: "ORD123456",
      status: "FAILED",
      failureReason: "Insufficient balance",
    });
  });
});
