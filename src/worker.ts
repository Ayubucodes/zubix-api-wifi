import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import { createProviders } from "./integrations/payments/registry.js";
import { buildOmadaControllerBaseUrl, OmadaClient } from "./integrations/omada/omada.client.js";
import { loadEnv } from "./config/env.js";
import { createWorkerApi, type WorkerRuntime } from "./worker-api.js";

interface WorkerBindings extends Record<string, string | undefined> {
  DATABASE_URL: string;
}

const api = createWorkerApi();
let cachedPaymentProviders: ReturnType<typeof createProviders> | undefined;

function createRuntime(bindings: WorkerBindings): WorkerRuntime {
  const env = loadEnv(bindings);
  cachedPaymentProviders ??= createProviders(env);
  const prisma = new PrismaClient({
    adapter: new PrismaNeon({ connectionString: env.DATABASE_URL }),
  });

  const controllerUrl = env.OMADA_CONTROLLER_URL;
  const controllerId = env.OMADA_CONTROLLER_ID;
  const operatorName = env.OMADA_USERNAME;
  const operatorPassword = env.OMADA_PASSWORD;
  const omadaFactory =
    controllerUrl && controllerId && operatorName && operatorPassword
      ? () =>
          new OmadaClient({
            baseUrl: buildOmadaControllerBaseUrl(controllerUrl, controllerId),
            operatorName,
            operatorPassword,
            cloudflareAccess:
              env.OMADA_ACCESS_CLIENT_ID && env.OMADA_ACCESS_CLIENT_SECRET
                ? { clientId: env.OMADA_ACCESS_CLIENT_ID, clientSecret: env.OMADA_ACCESS_CLIENT_SECRET }
                : undefined,
            paths:
              env.OMADA_LOGIN_PATH && env.OMADA_AUTHORIZE_PATH
                ? { login: env.OMADA_LOGIN_PATH, authorize: env.OMADA_AUTHORIZE_PATH }
                : undefined,
          })
      : null;

  const runtime: WorkerRuntime = {
    env,
    prisma,
    paymentProviders: cachedPaymentProviders,
    omadaFactory,
    voucherKeys:
      env.VOUCHER_HMAC_KEY && env.VOUCHER_ENCRYPTION_KEY
        ? { hmacKey: env.VOUCHER_HMAC_KEY, encryptionKeyHex: env.VOUCHER_ENCRYPTION_KEY }
        : null,
    accessTokenKey: new TextEncoder().encode(env.JWT_ACCESS_SECRET),
  };
  return runtime;
}

export default {
  async fetch(request: Request, bindings: WorkerBindings): Promise<Response> {
    const runtime = createRuntime(bindings);
    try {
      return await api.fetch(request, { runtime });
    } finally {
      await runtime.prisma.$disconnect();
    }
  },
};
