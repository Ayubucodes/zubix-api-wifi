import { Hono, type Context, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { SignJWT, jwtVerify } from "jose";
import type { PrismaClient } from "@prisma/client";
import { ZodError } from "zod";
import { AppError, parseOrThrow } from "./common/errors.js";
import type { AppEnv } from "./config/env.js";
import type { PermissionCode } from "./common/permissions.js";
import type { PaymentProvider, ProviderCode } from "./integrations/payments/payment.types.js";
import type { OmadaClient } from "./integrations/omada/omada.client.js";
import { loadAuthUser, type AuthUser } from "./modules/auth/auth-user.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { loginBodySchema, refreshBodySchema } from "./modules/auth/auth.schemas.js";
import { CustomersService } from "./modules/customers/customers.service.js";
import { DashboardService } from "./modules/dashboard/dashboard.service.js";
import { PackagesService } from "./modules/packages/packages.service.js";
import {
  createPackageSchema,
  idParamSchema,
  listPackagesQuerySchema,
  updatePackageSchema,
} from "./modules/packages/packages.schemas.js";
import { PaymentsService } from "./modules/payments/payments.service.js";
import { PublicService } from "./modules/public/public.service.js";
import { ReportsService, type DateRange } from "./modules/reports/reports.service.js";
import { SettingsService } from "./modules/settings/settings.service.js";
import { SubscriptionsService } from "./modules/subscriptions/subscriptions.service.js";
import { VouchersService, type VoucherKeys } from "./modules/vouchers/vouchers.service.js";
import { z } from "zod";

export interface WorkerRuntime {
  env: AppEnv;
  prisma: PrismaClient;
  paymentProviders: Map<ProviderCode, PaymentProvider>;
  omadaFactory: (() => OmadaClient) | null;
  voucherKeys: VoucherKeys | null;
  accessTokenKey: Uint8Array;
}

interface ApiEnvironment {
  Bindings: {
    runtime: WorkerRuntime;
  };
  Variables: {
    runtime: WorkerRuntime;
    currentUser: AuthUser;
  };
}

export function createWorkerApi(): Hono<ApiEnvironment> {
  const api = new Hono<ApiEnvironment>();

  api.use("*", async (context, next) => {
    context.set("runtime", context.env.runtime);
    await next();
  });
  api.use("*", secureHeaders());
  api.use(
    "*",
    cors({
      origin: (origin, context) =>
        context.env.runtime.env.CORS_ORIGINS.includes(origin) ? origin : "",
      credentials: true,
    }),
  );

  const loginBody = loginBodySchema;
  const refreshBody = refreshBodySchema;
  const idParam = z.object({ id: z.string().uuid() });

  const authServiceFor = (runtime: WorkerRuntime) =>
    new AuthService(runtime.prisma, {
      refreshTtlSeconds: runtime.env.JWT_REFRESH_TTL_SECONDS,
      accessTtlSeconds: runtime.env.JWT_ACCESS_TTL_SECONDS,
      signAccessToken: (userId) =>
        new SignJWT({ typ: "access" })
          .setProtectedHeader({ alg: "HS256" })
          .setSubject(userId)
          .setIssuedAt()
          .setExpirationTime(Math.floor(Date.now() / 1000) + runtime.env.JWT_ACCESS_TTL_SECONDS)
          .sign(runtime.accessTokenKey),
    });

  const packagesQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().max(80).optional(),
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  });
  const customerStatusBody = z.object({ status: z.enum(["ACTIVE", "SUSPENDED"]) });
  const subscriptionQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(["PENDING", "ACTIVE", "EXPIRED", "SUSPENDED", "CANCELLED"]).optional(),
  });
  const cancelSubscriptionBody = z.object({ reason: z.string().trim().min(5).max(200) });
  const paymentInitiateBody = z.object({
    packageId: z.string().uuid(),
    phoneNumber: z.string().min(9).max(20),
    providerCode: z.enum(["MOCK", "CLICKPESA", "SELCOM"]).optional(),
  });
  const paymentReferenceParam = z.object({ reference: z.string().regex(/^[A-Z0-9]{8,20}$/) });
  const paymentProviderParam = z.object({ provider: z.enum(["MOCK", "CLICKPESA", "SELCOM"]) });
  const paymentListQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum(["PENDING", "PROCESSING", "SUCCESS", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED"]).optional(),
    provider: z.enum(["MOCK", "CLICKPESA", "SELCOM"]).optional(),
    search: z.string().trim().max(80).optional(),
  });
  const mockCompleteBody = z.object({ status: z.enum(["SUCCESS", "FAILED"]) });
  const connectBody = z.object({
    subscriptionId: z.string().uuid(),
    clientMac: z.string().min(11).max(17),
    clientIp: z.string().ip(),
    apMac: z.string().min(11).max(17),
    ssidName: z.string().max(64).default(""),
    radioId: z.union([z.literal(0), z.literal(1)]).default(0),
  });
  const reportRangeQuery = z.object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  }).superRefine((value, ctx) => {
    const days = (value.to.getTime() - value.from.getTime()) / 86_400_000;
    if (days <= 0) ctx.addIssue({ code: "custom", message: "'to' must be after 'from'" });
    if (days > 366) ctx.addIssue({ code: "custom", message: "Range cannot exceed 366 days" });
  });
  const locationListQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });
  const locationCreateBody = z.object({
    name: z.string().trim().min(2).max(120),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, "Use letters, numbers and hyphens (2-20 characters)"),
    address: z.string().trim().max(255).nullable().optional(),
  });
  const voucherPageQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  });
  const voucherBatchBody = z.object({
    name: z.string().trim().min(2).max(120),
    packageId: z.string().uuid(),
    quantity: z.number().int().min(1).max(500),
    usageLimit: z.number().int().min(1).max(50).default(1),
    expiresAt: z.coerce.date().optional(),
  });
  const voucherListQuery = voucherPageQuery.extend({
    status: z.enum(["ACTIVE", "REVOKED", "EXPIRED", "EXHAUSTED"]).optional(),
    batchId: z.string().uuid().optional(),
    sold: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  });
  const voucherCodesQuery = z.object({ reason: z.string().trim().min(5, "Give a reason for revealing codes") });
  const voucherSaleBody = z.object({
    channel: z.enum(["CASH", "MOBILE_MONEY"]),
    amountTzs: z.number().int().min(0).max(100_000_000),
  });
  const voucherRevokeBody = z.object({ reason: z.string().trim().min(5).max(300) });
  const voucherRedeemBody = z.object({
    code: z.string().trim().min(6).max(64),
    phone: z.string().trim().min(9).max(20),
  });
  const settingProviderParam = z.object({ code: z.enum(["SELCOM", "CLICKPESA", "MOCK"]) });
  const settingProviderBody = z.object({ enabled: z.boolean() });
  const auditLogQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    entityType: z.string().trim().max(64).optional(),
  });

  api.get("/", (context) => {
    const { APP_NAME } = context.get("runtime").env;
    return context.json({
      name: APP_NAME,
      message: "API is running",
      links: { health: "/health", docs: "/docs", openapi: "/openapi.json" },
    });
  });

  api.get("/health", async (context) => {
    await context.get("runtime").prisma.$queryRaw`SELECT 1`;
    return context.json({ status: "ok", time: new Date().toISOString(), timezone: context.get("runtime").env.APP_TIMEZONE });
  });

  const v1 = new Hono<ApiEnvironment>();

  v1.post("/auth/login", rateLimit(10, 15 * 60_000), async (context) => {
    const runtime = context.get("runtime");
    const body = parseOrThrow(loginBody, await requestJson(context));
    const result = await authServiceFor(runtime).login(body.email, body.password, requestMeta(context));
    return context.json(result);
  });

  v1.post("/auth/refresh", rateLimit(30, 15 * 60_000), async (context) => {
    const body = parseOrThrow(refreshBody, await requestJson(context));
    return context.json(await authServiceFor(context.get("runtime")).refresh(body.refreshToken, requestMeta(context)));
  });

  v1.post("/auth/logout", async (context) => {
    const body = parseOrThrow(refreshBody, await requestJson(context));
    await authServiceFor(context.get("runtime")).logout(body.refreshToken);
    return new Response(null, { status: 204 });
  });

  v1.get("/auth/me", authorize(), async (context) => {
    return context.json(await authServiceFor(context.get("runtime")).me(context.get("currentUser").id));
  });

  const packages = new Hono<ApiEnvironment>();
  packages.get("/", authorize("packages:read"), async (context) => {
    const runtime = context.get("runtime");
    return context.json(await new PackagesService(runtime.prisma).list(parseOrThrow(listPackagesQuerySchema, context.req.query())));
  });
  packages.get("/:id", authorize("packages:read"), async (context) => {
    return context.json(await new PackagesService(context.get("runtime").prisma).get(
      parseOrThrow(idParamSchema, context.req.param()).id,
    ));
  });
  packages.post("/", authorize("packages:manage"), async (context) => {
    const input = parseOrThrow(createPackageSchema, await requestJson(context));
    const created = await new PackagesService(context.get("runtime").prisma).create(input, context.get("currentUser").id);
    return context.json(created, 201);
  });
  packages.patch("/:id", authorize("packages:manage"), async (context) => {
    const id = parseOrThrow(idParamSchema, context.req.param()).id;
    const input = parseOrThrow(updatePackageSchema, await requestJson(context));
    return context.json(await new PackagesService(context.get("runtime").prisma).update(id, input, context.get("currentUser").id));
  });
  packages.delete("/:id", authorize("packages:manage"), async (context) => {
    const id = parseOrThrow(idParamSchema, context.req.param()).id;
    await new PackagesService(context.get("runtime").prisma).archive(id, context.get("currentUser").id);
    return new Response(null, { status: 204 });
  });
  v1.route("/packages", packages);

  const customers = new Hono<ApiEnvironment>();
  customers.get("/", authorize("customers:read"), async (context) => {
    const query = parseOrThrow(packagesQuery, context.req.query());
    return context.json(await new CustomersService(context.get("runtime").prisma).list(query));
  });
  customers.get("/:id", authorize("customers:read"), async (context) => {
    const id = parseOrThrow(idParam, context.req.param()).id;
    return context.json(await new CustomersService(context.get("runtime").prisma).detail(id));
  });
  customers.patch("/:id/status", authorize("customers:manage"), async (context) => {
    const id = parseOrThrow(idParam, context.req.param()).id;
    const { status } = parseOrThrow(customerStatusBody, await requestJson(context));
    return context.json(await new CustomersService(context.get("runtime").prisma).setStatus(id, status, context.get("currentUser").id));
  });
  v1.route("/customers", customers);

  const subscriptions = new Hono<ApiEnvironment>();
  subscriptions.get("/", authorize("subscriptions:read"), async (context) => {
    return context.json(await new SubscriptionsService(context.get("runtime").prisma).list(
      parseOrThrow(subscriptionQuery, context.req.query()),
    ));
  });
  subscriptions.get("/:id", authorize("subscriptions:read"), async (context) => {
    const id = parseOrThrow(idParam, context.req.param()).id;
    return context.json(await new SubscriptionsService(context.get("runtime").prisma).detail(id));
  });
  subscriptions.post("/:id/cancel", authorize("subscriptions:manage"), async (context) => {
    const id = parseOrThrow(idParam, context.req.param()).id;
    const { reason } = parseOrThrow(cancelSubscriptionBody, await requestJson(context));
    return context.json(await new SubscriptionsService(context.get("runtime").prisma).cancel(
      id,
      reason,
      context.get("currentUser").id,
    ));
  });
  v1.route("/subscriptions", subscriptions);

  const payments = new Hono<ApiEnvironment>();
  payments.post("/initiate", rateLimit(20, 60_000), async (context) => {
    const body = parseOrThrow(paymentInitiateBody, await requestJson(context));
    const idempotencyKey = context.req.header("idempotency-key");
    const payment = await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders).initiate({
      packageId: body.packageId,
      phoneNumber: body.phoneNumber,
      providerCode: body.providerCode,
      idempotencyKey: idempotencyKey?.slice(0, 100),
    });
    return context.json(payment, 201);
  });
  payments.get("/status/:reference", rateLimit(120, 60_000), async (context) => {
    const { reference } = parseOrThrow(paymentReferenceParam, context.req.param());
    const runtime = context.get("runtime");
    const service = new PaymentsService(runtime.prisma, runtime.paymentProviders);
    const payment = await service.getByReference(reference);
    const subscription =
      payment.status === "SUCCESS"
        ? await runtime.prisma.subscription.findUnique({
            where: { paymentId: payment.id },
            select: { id: true, expiresAt: true },
          })
        : null;
    return context.json({
      reference: payment.reference,
      status: payment.status,
      amountTzs: payment.amountTzs,
      packageName: payment.packageName,
      failureReason: payment.status === "FAILED" ? payment.failureReason : null,
      providerCode: payment.providerCode,
      subscriptionId: subscription?.id ?? null,
      expiresAt: subscription?.expiresAt?.toISOString() ?? null,
    });
  });
  payments.post("/webhooks/:provider", async (context) => {
    const { provider } = parseOrThrow(paymentProviderParam, context.req.param());
    const body = (await requestJsonOrEmpty(context)) as Record<string, unknown>;
    const outcome = await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders)
      .processWebhook(provider, body);
    return context.json({ outcome });
  });
  payments.get("/", authorize("payments:read"), async (context) => {
    return context.json(await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders)
      .list(parseOrThrow(paymentListQuery, context.req.query())));
  });
  payments.get("/:reference", authorize("payments:read"), async (context) => {
    const { reference } = parseOrThrow(paymentReferenceParam, context.req.param());
    return context.json(await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders)
      .getByReference(reference));
  });
  payments.post("/dev/mock/:reference/complete", async (context) => {
    if (context.get("runtime").env.APP_ENV === "production") {
      return errorResponse(404, "NOT_FOUND", "Route not found");
    }
    const { reference } = parseOrThrow(paymentReferenceParam, context.req.param());
    const { status } = parseOrThrow(mockCompleteBody, await requestJson(context));
    const outcome = await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders)
      .simulateMockCallback(reference, status);
    return context.json({ outcome });
  });
  v1.route("/payments", payments);

  const publicRoutes = new Hono<ApiEnvironment>();
  publicRoutes.get("/config", rateLimit(60, 60_000), async (context) => {
    const runtime = context.get("runtime");
    const service = new PublicService(runtime.prisma, runtime.omadaFactory);
    return context.json({
      appName: runtime.env.APP_NAME,
      supportPhone: runtime.env.SUPPORT_PHONE ?? null,
      providers: await service.enabledProviders(new Set<string>(runtime.paymentProviders.keys())),
    });
  });
  publicRoutes.get("/packages", rateLimit(60, 60_000), async (context) => {
    return context.json(await new PublicService(context.get("runtime").prisma, context.get("runtime").omadaFactory).listPackages());
  });
  publicRoutes.post("/connect", rateLimit(10, 60_000), async (context) => {
    const input = parseOrThrow(connectBody, await requestJson(context));
    const runtime = context.get("runtime");
    return context.json(await new PublicService(runtime.prisma, runtime.omadaFactory).connect(input));
  });
  v1.route("/public", publicRoutes);

  const reports = new Hono<ApiEnvironment>();
  const range = (input: unknown): DateRange => {
    const { from, to } = parseOrThrow(reportRangeQuery, input);
    return { from, to };
  };
  reports.get("/revenue", authorize("reports:read"), async (context) => {
    return context.json(await new ReportsService(context.get("runtime").prisma).revenue(range(context.req.query())));
  });
  reports.get("/vouchers", authorize("reports:read"), async (context) => {
    return context.json(await new ReportsService(context.get("runtime").prisma).voucherSales(range(context.req.query())));
  });
  reports.get("/customers", authorize("reports:read"), async (context) => {
    return context.json(await new ReportsService(context.get("runtime").prisma).customerGrowth(range(context.req.query())));
  });
  reports.get("/payments.csv", authorize("reports:read"), async (context) => {
    const csv = await new ReportsService(context.get("runtime").prisma).paymentsCsv(range(context.req.query()));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="payments.csv"',
      },
    });
  });
  v1.route("/reports", reports);

  const settings = new Hono<ApiEnvironment>();
  settings.get("/payment-providers", authorize("settings:manage"), async (context) => {
    const runtime = context.get("runtime");
    return context.json(await new SettingsService(runtime.prisma, {
      appEnv: runtime.env.APP_ENV,
      registeredProviders: new Set<string>(runtime.paymentProviders.keys()),
    }).listProviders());
  });
  settings.patch("/payment-providers/:code", authorize("settings:manage"), async (context) => {
    const { code } = parseOrThrow(settingProviderParam, context.req.param());
    const { enabled } = parseOrThrow(settingProviderBody, await requestJson(context));
    const runtime = context.get("runtime");
    return context.json(await new SettingsService(runtime.prisma, {
      appEnv: runtime.env.APP_ENV,
      registeredProviders: new Set<string>(runtime.paymentProviders.keys()),
    }).setProviderEnabled(code, enabled, context.get("currentUser").id));
  });
  settings.get("/audit-log", authorize("audit:read"), async (context) => {
    const runtime = context.get("runtime");
    return context.json(await new SettingsService(runtime.prisma, {
      appEnv: runtime.env.APP_ENV,
      registeredProviders: new Set<string>(runtime.paymentProviders.keys()),
    }).auditLog(parseOrThrow(auditLogQuery, context.req.query())));
  });
  v1.route("/settings", settings);

  const vouchers = new Hono<ApiEnvironment>();
  vouchers.post("/redeem", rateLimit(10, 15 * 60_000), async (context) => {
    const { code, phone } = parseOrThrow(voucherRedeemBody, await requestJson(context));
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).redeem(code, phone));
  });
  vouchers.get("/batches", authorize("vouchers:read"), async (context) => {
    const { page, pageSize } = parseOrThrow(voucherPageQuery, context.req.query());
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).listBatches(page, pageSize));
  });
  vouchers.post("/batches", authorize("vouchers:manage"), async (context) => {
    const input = parseOrThrow(voucherBatchBody, await requestJson(context));
    const created = await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).createBatch(input, context.get("currentUser").id);
    return context.json(created, 201);
  });
  vouchers.get("/batches/:id/codes", authorize("vouchers:manage"), async (context) => {
    const { id } = parseOrThrow(idParam, context.req.param());
    const { reason } = parseOrThrow(voucherCodesQuery, context.req.query());
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).batchCodes(id, context.get("currentUser").id, reason));
  });
  vouchers.get("/", authorize("vouchers:read"), async (context) => {
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).list(parseOrThrow(voucherListQuery, context.req.query())));
  });
  vouchers.get("/:id", authorize("vouchers:read"), async (context) => {
    const { id } = parseOrThrow(idParam, context.req.param());
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).detail(id));
  });
  vouchers.post("/:id/sale", authorize("vouchers:sell"), async (context) => {
    const { id } = parseOrThrow(idParam, context.req.param());
    const input = parseOrThrow(voucherSaleBody, await requestJson(context));
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).recordSale(id, input.channel, input.amountTzs, context.get("currentUser").id));
  });
  vouchers.post("/:id/revoke", authorize("vouchers:manage"), async (context) => {
    const { id } = parseOrThrow(idParam, context.req.param());
    const { reason } = parseOrThrow(voucherRevokeBody, await requestJson(context));
    return context.json(await new VouchersService(
      context.get("runtime").prisma,
      context.get("runtime").voucherKeys,
    ).revoke(id, reason, context.get("currentUser").id));
  });
  v1.route("/vouchers", vouchers);

  const locations = new Hono<ApiEnvironment>();
  locations.get("/", authorize("locations:read"), async (context) => {
    const query = parseOrThrow(locationListQuery, context.req.query());
    const where = { isActive: true };
    const [items, total] = await Promise.all([
      context.get("runtime").prisma.location.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, name: true, code: true, address: true, timezone: true },
      }),
      context.get("runtime").prisma.location.count({ where }),
    ]);
    return context.json({ items, page: query.page, pageSize: query.pageSize, total });
  });
  locations.post("/", authorize("locations:manage"), async (context) => {
    const body = parseOrThrow(locationCreateBody, await requestJson(context));
    const prisma = context.get("runtime").prisma;
    const existing = await prisma.location.findUnique({ where: { code: body.code } });
    if (existing) {
      throw AppError.conflict("A location with this code already exists");
    }
    const actorUserId = context.get("currentUser").id;
    const location = await prisma.$transaction(async (tx) => {
      const created = await tx.location.create({
        data: { name: body.name, code: body.code, address: body.address ?? null },
        select: { id: true, name: true, code: true, address: true, timezone: true },
      });
      await tx.auditLog.create({
        data: { actorUserId, action: "location.create", entityType: "Location", entityId: created.id },
      });
      return created;
    });
    return context.json(location, 201);
  });
  v1.route("/locations", locations);

  const dashboard = new Hono<ApiEnvironment>();
  dashboard.get("/overview", authorize("reports:read"), async (context) => {
    return context.json(await new DashboardService(context.get("runtime").prisma).overview());
  });
  v1.route("/dashboard", dashboard);

  const network = new Hono<ApiEnvironment>();
  network.get("/overview", authorize("network:read"), async (context) => {
    const prisma = context.get("runtime").prisma;
    const [controllers, sites, accessPoints, activeSessions, events] = await Promise.all([
      prisma.omadaController.findMany({
        select: { id: true, name: true, baseUrl: true, isActive: true, lastTestedAt: true, lastTestStatus: true, lastError: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.networkSite.findMany({
        select: { id: true, name: true, omadaSiteId: true, isActive: true, controllerId: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.accessPoint.findMany({
        select: { id: true, name: true, model: true, macAddress: true, status: true, lastSeenAt: true, networkSiteId: true },
        orderBy: { name: "asc" },
      }),
      prisma.wifiSession.count({ where: { disconnectedAt: null } }),
      prisma.networkEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, severity: true, message: true, createdAt: true },
      }),
    ]);
    return context.json({
      dataSource: "database",
      note: "Live controller data is not synced yet. Values reflect the last recorded state.",
      controllers: controllers.map((controller) => ({
        ...controller,
        lastTestedAt: controller.lastTestedAt?.toISOString() ?? null,
      })),
      sites,
      accessPoints: accessPoints.map((point) => ({ ...point, lastSeenAt: point.lastSeenAt?.toISOString() ?? null })),
      activeSessionCount: activeSessions,
      recentEvents: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
    });
  });
  v1.route("/network", network);

  api.route("/api/v1", v1);

  // Keep the legacy ClickPesa URL already used in merchant webhook settings working.
  api.post("/api/payments/webhook/clickpesa", async (context) => {
    const body = (await requestJsonOrEmpty(context)) as Record<string, unknown>;
    const outcome = await new PaymentsService(context.get("runtime").prisma, context.get("runtime").paymentProviders)
      .processWebhook("CLICKPESA", body);
    return context.json({ outcome });
  });

  api.get("/openapi.json", (context) => context.json(openApiDocument));
  api.get("/docs", () => new Response(docsHtml, { headers: { "content-type": "text/html; charset=utf-8" } }));

  api.onError((error, context) => {
    if (error instanceof AppError) {
      return errorResponse(error.statusCode, error.code, error.message, error.details);
    }
    if (error instanceof ZodError) {
      return errorResponse(400, "BAD_REQUEST", "Invalid request", error.issues);
    }
    console.error("Unhandled API error", error instanceof Error ? { name: error.name, message: error.message } : String(error));
    return errorResponse(500, "INTERNAL_ERROR", "An unexpected error occurred");
  });

  api.notFound(() => errorResponse(404, "NOT_FOUND", "Route not found"));

    return api;
}

function authorize(...required: PermissionCode[]): MiddlewareHandler<ApiEnvironment> {
  return async (context, next) => {
    const runtime = context.get("runtime");
    const authorization = context.req.header("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw AppError.unauthorized();
    }

    let subject: string;
    try {
      const { payload } = await jwtVerify(token, runtime.accessTokenKey, { algorithms: ["HS256"] });
      if (payload.typ !== "access" || typeof payload.sub !== "string") {
        throw new Error("Invalid access token claims");
      }
      subject = payload.sub;
    } catch {
      throw AppError.unauthorized();
    }

    const user = await loadAuthUser(runtime.prisma, subject);
    if (!user) {
      throw AppError.unauthorized();
    }
    const allowed = user.roles.includes("SUPER_ADMIN") || required.every((permission) => user.permissions.includes(permission));
    if (!allowed) {
      throw AppError.forbidden();
    }
    context.set("currentUser", user);
    await next();
  };
}

function rateLimit(maximum: number, windowMs: number): MiddlewareHandler<ApiEnvironment> {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (context, next) => {
    const now = Date.now();
    const key = clientIp(context);
    const current = buckets.get(key);
    if (current && current.resetAt > now && current.count >= maximum) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      return context.json(
        { statusCode: 429, error: "Too Many Requests", message: `Rate limit exceeded, retry in ${retryAfter} seconds` },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
    }
    if (buckets.size > 2000) {
      for (const [ip, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(ip);
      }
    }
    await next();
  };
}

async function requestJson(context: Context<ApiEnvironment>): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw AppError.badRequest("Invalid JSON");
  }
}

async function requestJsonOrEmpty(context: Context<ApiEnvironment>): Promise<unknown> {
  try {
    const body = await context.req.text();
    return body.trim() ? JSON.parse(body) : {};
  } catch {
    throw AppError.badRequest("Invalid JSON");
  }
}

function requestMeta(context: Context<ApiEnvironment>) {
  return {
    ipAddress: clientIp(context),
    userAgent: context.req.header("user-agent"),
  };
}

function clientIp(context: Context<ApiEnvironment>): string {
  return context.req.header("cf-connecting-ip") ?? context.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

function errorResponse(status: number, code: string, message: string, details?: unknown): Response {
  const error = details === undefined ? { code, message } : { code, message, details };
  return Response.json({ error }, { status });
}

const openApiRoutes: Array<[string, string, string]> = [
  ["GET", "/", "API status and links"],
  ["GET", "/health", "Database health check"],
  ["POST", "/api/v1/auth/login", "Sign in"],
  ["POST", "/api/v1/auth/refresh", "Rotate refresh token"],
  ["POST", "/api/v1/auth/logout", "Revoke refresh token"],
  ["GET", "/api/v1/auth/me", "Current user"],
  ["GET", "/api/v1/packages", "List packages"],
  ["GET", "/api/v1/packages/{id}", "Get a package"],
  ["POST", "/api/v1/packages", "Create a package"],
  ["PATCH", "/api/v1/packages/{id}", "Update a package"],
  ["DELETE", "/api/v1/packages/{id}", "Archive a package"],
  ["GET", "/api/v1/customers", "List customers"],
  ["GET", "/api/v1/customers/{id}", "Get customer details"],
  ["PATCH", "/api/v1/customers/{id}/status", "Change customer status"],
  ["GET", "/api/v1/subscriptions", "List subscriptions"],
  ["GET", "/api/v1/subscriptions/{id}", "Get subscription details"],
  ["POST", "/api/v1/subscriptions/{id}/cancel", "Cancel a subscription"],
  ["POST", "/api/v1/payments/initiate", "Initiate a payment"],
  ["GET", "/api/v1/payments/status/{reference}", "Poll payment status"],
  ["POST", "/api/v1/payments/webhooks/{provider}", "Provider webhook"],
  ["GET", "/api/v1/payments", "List payments"],
  ["GET", "/api/v1/payments/{reference}", "Payment details"],
  ["GET", "/api/v1/public/config", "Portal configuration"],
  ["GET", "/api/v1/public/packages", "Packages for sale"],
  ["POST", "/api/v1/public/connect", "Connect a paid device"],
  ["GET", "/api/v1/reports/revenue", "Revenue report"],
  ["GET", "/api/v1/reports/vouchers", "Voucher sales report"],
  ["GET", "/api/v1/reports/customers", "Customer growth report"],
  ["GET", "/api/v1/reports/payments.csv", "Payments CSV export"],
  ["GET", "/api/v1/settings/payment-providers", "List payment providers"],
  ["PATCH", "/api/v1/settings/payment-providers/{code}", "Toggle a payment provider"],
  ["GET", "/api/v1/settings/audit-log", "Audit log"],
  ["POST", "/api/v1/vouchers/redeem", "Redeem a voucher"],
  ["GET", "/api/v1/vouchers/batches", "List voucher batches"],
  ["POST", "/api/v1/vouchers/batches", "Create a voucher batch"],
  ["GET", "/api/v1/vouchers/batches/{id}/codes", "Reveal batch codes"],
  ["GET", "/api/v1/vouchers", "List vouchers"],
  ["GET", "/api/v1/vouchers/{id}", "Voucher details"],
  ["POST", "/api/v1/vouchers/{id}/sale", "Record a voucher sale"],
  ["POST", "/api/v1/vouchers/{id}/revoke", "Revoke a voucher"],
  ["GET", "/api/v1/locations", "List locations"],
  ["POST", "/api/v1/locations", "Create a location"],
  ["GET", "/api/v1/dashboard/overview", "Dashboard overview"],
  ["GET", "/api/v1/network/overview", "Network overview"],
];
const openApiPaths = Object.fromEntries(openApiRoutes.map(([method, path, summary]) => [
  path,
  {
    [method.toLowerCase()]: {
      summary,
      responses: { "200": { description: "Successful response" } },
    },
  },
]));
const openApiDocument = {
  openapi: "3.0.3",
  info: { title: "Zubix WiFi API", version: "0.1.0" },
  paths: openApiPaths,
};
const docsHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Zubix WiFi API</title></head><body><h1>Zubix WiFi API</h1><p><a href="/openapi.json">OpenAPI specification</a></p><ul>${openApiRoutes.map(([method, path, summary]) => `<li><code>${method}</code> <code>${path}</code> - ${summary}</li>`).join("")}</ul></body></html>`;
