import { describe, expect, it, vi } from "vitest";
import { OmadaClient, OmadaError } from "../src/integrations/omada/omada.client.js";

function loginResponse(): Response {
  return new Response(JSON.stringify({ errorCode: 0, result: { token: "csrf-123" } }), {
    status: 200,
    headers: { "content-type": "application/json", "set-cookie": "TPOMADA_SESSIONID=sess-abc; Path=/; HttpOnly" },
  });
}

function okResponse(): Response {
  return new Response(JSON.stringify({ errorCode: 0 }), { status: 200, headers: { "content-type": "application/json" } });
}

const baseInput = {
  clientMac: "AA:BB:CC:DD:EE:FF",
  clientIp: "192.168.0.18",
  time: 1794230995000,
  apMac: "58:04:4F:EA:E2:90",
  ssidName: "Zubix",
  radioId: 1 as const,
};

describe("OmadaClient", () => {
  it("calls the Worker fetch function with its required global receiver", async () => {
    const receivers: unknown[] = [];
    const fetchImpl = vi.fn(async function (this: unknown) {
      receivers.push(this);
      return receivers.length === 1 ? loginResponse() : okResponse();
    }) as unknown as typeof fetch;
    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "hotspot-op",
      operatorPassword: "pw",
      fetchImpl,
      sleep: async () => undefined,
    });

    await client.authorizeClient(baseInput);

    expect(receivers).toEqual([globalThis, globalThis]);
  });

  it("logs in as operator then authorizes with cookie and CSRF token", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return calls.length === 1 ? loginResponse() : okResponse();
    }) as unknown as typeof fetch;

    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "hotspot-op",
      operatorPassword: "pw",
      fetchImpl,
      sleep: async () => undefined,
    });

    await client.authorizeClient(baseInput);

    expect(calls[0]?.url).toBe("https://omada.local:8043/api/v2/hotspot/login");
    expect(calls[1]?.url).toBe("https://omada.local:8043/api/v2/hotspot/extPortal/auth");
    const headers = calls[1]?.init.headers as Record<string, string>;
    expect(headers.cookie).toBe("TPOMADA_SESSIONID=sess-abc");
    expect(headers["Csrf-Token"]).toBe("csrf-123");

    const body = JSON.parse(String(calls[1]?.init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ clientMac: baseInput.clientMac, authType: 4, radioId: 1, ssidName: "Zubix" });
  });

  it("sends Cloudflare Access service-token headers to the controller", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return calls.length === 1 ? loginResponse() : okResponse();
    }) as unknown as typeof fetch;
    const client = new OmadaClient({
      baseUrl: "https://omada.example.com",
      operatorName: "hotspot-op",
      operatorPassword: "pw",
      cloudflareAccess: { clientId: "access-id", clientSecret: "access-secret" },
      fetchImpl,
      sleep: async () => undefined,
    });

    await client.authorizeClient(baseInput);

    for (const call of calls) {
      expect(call.init.headers).toMatchObject({
        "CF-Access-Client-Id": "access-id",
        "CF-Access-Client-Secret": "access-secret",
      });
    }
  });

  it("retries transient 5xx responses with backoff", async () => {
    const responses = [new Response("", { status: 503 }), loginResponse(), new Response("", { status: 502 }), okResponse()];
    const fetchImpl = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch;
    const sleep = vi.fn(async () => undefined);
    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "op",
      operatorPassword: "pw",
      fetchImpl,
      sleep,
    });

    await client.authorizeClient(baseInput);
    expect(sleep).toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws a retryable OmadaError when the controller is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "op",
      operatorPassword: "pw",
      fetchImpl,
      sleep: async () => undefined,
      maxRetries: 2,
    });

    await expect(client.login()).rejects.toMatchObject({ name: "OmadaError", retryable: true });
  });

  it("surfaces a controller error code without claiming success", async () => {
    const responses = [loginResponse(), new Response(JSON.stringify({ errorCode: -33000 }), { status: 200 })];
    const fetchImpl = vi.fn(async () => responses.shift() as Response) as unknown as typeof fetch;
    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "op",
      operatorPassword: "pw",
      fetchImpl,
      sleep: async () => undefined,
    });

    const error = await client.authorizeClient(baseInput).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OmadaError);
    expect((error as OmadaError).controllerErrorCode).toBe(-33000);
    expect((error as OmadaError).retryable).toBe(false);
  });

  it("rejects a login response that has no token or session cookie", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ errorCode: 0 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new OmadaClient({
      baseUrl: "https://omada.local:8043",
      operatorName: "op",
      operatorPassword: "pw",
      fetchImpl,
      sleep: async () => undefined,
    });
    await expect(client.login()).rejects.toBeInstanceOf(OmadaError);
  });
});
