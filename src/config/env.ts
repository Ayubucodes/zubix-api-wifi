import { z } from "zod";

const envSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_TIMEZONE: z.string().default("Africa/Dar_es_Salaam"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(1209600),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:5174")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),
  VOUCHER_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "VOUCHER_ENCRYPTION_KEY must be 32 bytes as 64 hex characters")
    .optional(),
  VOUCHER_HMAC_KEY: z.string().min(32).optional(),
  MOCK_WEBHOOK_SECRET: z.string().min(16).optional(),
  CLICKPESA_BASE_URL: z.string().url().optional(),
  CLICKPESA_CLIENT_ID: z.string().optional(),
  CLICKPESA_API_KEY: z.string().optional(),
  CLICKPESA_CLIENT_SECRET: z.string().optional(),
  CLICKPESA_CHECKSUM_SECRET: z.string().optional(),
  APP_NAME: z.string().default("Zubix WiFi"),
  SUPPORT_PHONE: z.string().optional(),
  OMADA_CONTROLLER_URL: z.string().url().optional(),
  OMADA_USERNAME: z.string().optional(),
  OMADA_PASSWORD: z.string().optional(),
  OMADA_LOGIN_PATH: z.string().optional(),
  OMADA_AUTHORIZE_PATH: z.string().optional(),
  OMADA_ACCESS_CLIENT_ID: z.string().optional(),
  OMADA_ACCESS_CLIENT_SECRET: z.string().optional(),
}).superRefine((env, context) => {
  if (Boolean(env.OMADA_ACCESS_CLIENT_ID) !== Boolean(env.OMADA_ACCESS_CLIENT_SECRET)) {
    context.addIssue({
      code: "custom",
      path: ["OMADA_ACCESS_CLIENT_SECRET"],
      message: "OMADA_ACCESS_CLIENT_ID and OMADA_ACCESS_CLIENT_SECRET must be set together",
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  // A blank value in .env (for example "CLICKPESA_BASE_URL=") means "not set", not an empty string.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
