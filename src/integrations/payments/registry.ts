import { randomBytes } from "node:crypto";
import type { AppEnv } from "../../config/env.js";
import { ClickPesaProvider } from "./clickpesa.provider.js";
import { assertMockProviderAllowed, MockProvider } from "./mock.provider.js";
import type { PaymentProvider, ProviderCode } from "./payment.types.js";

/**
 * Registers only the providers whose configuration is present. The mock provider is never
 * registered in production. Providers that are not registered cannot be used, even if an admin
 * enables them in the database.
 */
export function createProviders(env: AppEnv): Map<ProviderCode, PaymentProvider> {
  const providers = new Map<ProviderCode, PaymentProvider>();

  if (env.APP_ENV !== "production") {
    assertMockProviderAllowed(env.APP_ENV);
    const secret = env.MOCK_WEBHOOK_SECRET ?? randomBytes(24).toString("hex");
    providers.set("MOCK", new MockProvider(secret));
  }

  const clickPesaApiKey = env.CLICKPESA_API_KEY ?? env.CLICKPESA_CLIENT_SECRET;
  if (env.CLICKPESA_BASE_URL && env.CLICKPESA_CLIENT_ID && clickPesaApiKey) {
    providers.set(
      "CLICKPESA",
      new ClickPesaProvider({
        baseUrl: env.CLICKPESA_BASE_URL,
        clientId: env.CLICKPESA_CLIENT_ID,
        apiKey: clickPesaApiKey,
        checksumSecret: env.CLICKPESA_CHECKSUM_SECRET,
      }),
    );
  }

  return providers;
}
