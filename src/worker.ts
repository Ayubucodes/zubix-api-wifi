import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

interface WorkerBindings extends Record<string, string | undefined> {
  DATABASE_URL: string;
}

const supportedMethods = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"] as const;
type SupportedMethod = (typeof supportedMethods)[number];

let appPromise: Promise<FastifyInstance> | undefined;

function getApp(bindings: WorkerBindings): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = createApp(bindings).catch((error: unknown) => {
      appPromise = undefined;
      throw error;
    });
  }
  return appPromise;
}

async function createApp(bindings: WorkerBindings): Promise<FastifyInstance> {
  const env = loadEnv(bindings);
  const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const app = await buildApp({ env, prisma, logger: false });
    await app.ready();
    return app;
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

export default {
  async fetch(request: Request, bindings: WorkerBindings): Promise<Response> {
    const method = supportedMethods.find((candidate) => candidate === request.method);
    if (!method) {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: supportedMethods.join(", ") } });
    }

    const body = await readRequestBody(request, method);
    if (body instanceof Response) {
      return body;
    }

    const headers: Record<string, string> = Object.fromEntries(request.headers);
    const clientIp = request.headers.get("cf-connecting-ip");
    if (clientIp && !headers["x-forwarded-for"]) {
      headers["x-forwarded-for"] = clientIp;
    }

    const url = new URL(request.url);
    const app = await getApp(bindings);
    const result = await app.inject({
      method,
      url: `${url.pathname}${url.search}`,
      headers,
      payload: body,
    });

    const responseHeaders = new Headers();
    for (const [name, value] of Object.entries(result.headers)) {
      if (value === undefined || isHopByHopHeader(name)) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          responseHeaders.append(name, String(item));
        }
      } else {
        responseHeaders.set(name, String(value));
      }
    }

    const noBody = method === "HEAD" || result.statusCode === 204 || result.statusCode === 304;
    if (noBody) {
      responseHeaders.delete("content-length");
    }
    return new Response(noBody ? null : new Uint8Array(result.rawPayload), {
      status: result.statusCode,
      headers: responseHeaders,
    });
  },
};

async function readRequestBody(request: Request, method: SupportedMethod): Promise<Buffer | Response | undefined> {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return undefined;
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > 64 * 1024) {
        await reader.cancel();
        return new Response("Payload Too Large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return Buffer.from(body);
}

function isHopByHopHeader(name: string): boolean {
  return [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ].includes(name.toLowerCase());
}
