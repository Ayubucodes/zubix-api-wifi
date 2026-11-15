import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/config/env.js";
import { createWorkerApi, type WorkerRuntime } from "../src/worker-api.js";

function createRuntime(timezone: string): WorkerRuntime {
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
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
    const api = createWorkerApi();

    const response = await api.fetch(new Request("https://api.example/"), {
      runtime: createRuntime("UTC"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      name: "Test API",
      message: "API is running",
      links: { health: "/health", docs: "/docs", openapi: "/openapi.json" },
    });
  });

  it("serves health checks and binds each app to its own runtime", async () => {
    const api = createWorkerApi();

    const firstResponse = await api.fetch(new Request("https://api.example/health"), {
      runtime: createRuntime("Africa/Dar_es_Salaam"),
    });
    const secondResponse = await api.fetch(new Request("https://api.example/health"), {
      runtime: createRuntime("UTC"),
    });

    expect(firstResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      status: "ok",
      timezone: "Africa/Dar_es_Salaam",
    });
    await expect(secondResponse.json()).resolves.toMatchObject({ timezone: "UTC" });
  });

  it("returns a JSON 404 for unknown paths", async () => {
    const api = createWorkerApi();

    const response = await api.fetch(new Request("https://api.example/not-a-route"), {
      runtime: createRuntime("UTC"),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  it("returns a handled unauthorized response for unknown login emails", async () => {
    const api = createWorkerApi();
    const response = await api.fetch(
      new Request("https://api.example/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "admin@zubix.local", password: "not-the-password" }),
      }),
      { runtime: createRuntime("UTC") },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
    });
  });

  it("applies CORS to requests from configured origins", async () => {
    const api = createWorkerApi();

    const response = await api.fetch(
      new Request("https://api.example/health", {
        headers: { Origin: "https://portal.example" },
      }),
      { runtime: createRuntime("UTC") },
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://portal.example");
  });
});
