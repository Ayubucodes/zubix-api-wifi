import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/config/env.js";
import { createWorkerApi, type WorkerRuntime } from "../src/worker-api.js";

function createRuntime(timezone: string): WorkerRuntime {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  } as unknown as PrismaClient;

  return {
    env: {
      APP_ENV: "test",
      APP_TIMEZONE: timezone,
      APP_NAME: "Test API",
      CORS_ORIGINS: ["https://portal.example"],
      JWT_ACCESS_TTL_SECONDS: 900,
      JWT_REFRESH_TTL_SECONDS: 1209600,
    } as AppEnv,
    prisma,
    paymentProviders: new Map(),
    omadaFactory: null,
    voucherKeys: null,
    accessTokenKey: new Uint8Array(32),
  };
}

describe("Cloudflare Worker API", () => {
  it("shows API links at the root path", async () => {
    const api = createWorkerApi(createRuntime("UTC"));

    const response = await api.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "Test API",
      message: "API is running",
      links: { health: "/health", docs: "/docs", openapi: "/openapi.json" },
    });
  });

  it("serves health checks and binds each app to its own runtime", async () => {
    const first = createWorkerApi(createRuntime("Africa/Dar_es_Salaam"));
    const second = createWorkerApi(createRuntime("UTC"));

    const firstResponse = await first.request("/health");
    const secondResponse = await second.request("/health");

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      status: "ok",
      timezone: "Africa/Dar_es_Salaam",
    });
    await expect(secondResponse.json()).resolves.toMatchObject({ timezone: "UTC" });
  });

  it("returns a JSON 404 for unknown paths", async () => {
    const api = createWorkerApi(createRuntime("UTC"));

    const response = await api.request("/not-a-route");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("applies CORS to requests from configured origins", async () => {
    const api = createWorkerApi(createRuntime("UTC"));

    const response = await api.request("/health", {
      headers: { Origin: "https://portal.example" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("https://portal.example");
  });
});
