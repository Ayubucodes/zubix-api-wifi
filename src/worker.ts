import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import { createProviders } from "./integrations/payments/registry.js";
import { OmadaClient } from "./integrations/omada/omada.client.js";
import { loadEnv } from "./config/env.js";
import { createWorkerApi, type WorkerRuntime } from "./worker-api.js";

interface WorkerBindings extends Record<string, string | undefined> {
  DATABASE_URL: string;
}

let apiPromise: Promise<ReturnType<typeof createWorkerApi>> | undefined;

function getApi(bindings: WorkerBindings): Promise<ReturnType<typeof createWorkerApi>> {
  if (!apiPromise) {
    apiPromise = createApi(bindings).catch((error: unknown) => {
      apiPromise = undefined;
      throw error;
    });
  }
  return apiPromise;
}

function createApi(bindings: WorkerBindings): Promise<ReturnType<typeof createWorkerApi>> {
  const env = loadEnv(bindings);
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }),
  });

  const controllerUrl = env.OMADA_CONTROLLER_URL;
  const operatorName = env.OMADA_USERNAME;
  const operatorPassword = env.OMADA_PASSWORD;
  const omadaFactory =
    controllerUrl && operatorName && operatorPassword
      ? () =>
          new OmadaClient({
            baseUrl: controllerUrl,
            operatorName,
            operatorPassword,
            paths:
              env.OMADA_LOGIN_PATH && env.OMADA_AUTHORIZE_PATH
                ? { login: env.OMADA_LOGIN_PATH, authorize: env.OMADA_AUTHORIZE_PATH }
                : undefined,
          })
      : null;

  const runtime: WorkerRuntime = {
    env,
    prisma,
    paymentProviders: createProviders(env),
    omadaFactory,
    voucherKeys:
      env.VOUCHER_HMAC_KEY && env.VOUCHER_ENCRYPTION_KEY
        ? { hmacKey: env.VOUCHER_HMAC_KEY, encryptionKeyHex: env.VOUCHER_ENCRYPTION_KEY }
        : null,
    accessTokenKey: new TextEncoder().encode(env.JWT_ACCESS_SECRET),
  };

  return Promise.resolve(createWorkerApi(runtime));
}

export default {
  async fetch(request: Request, bindings: WorkerBindings): Promise<Response> {
    const api = await getApi(bindings);
    return api.fetch(request);
  },
};
