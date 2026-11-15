# Deploying the API to Cloudflare Workers

The Cloudflare Worker uses a Worker-native Hono API implementation and Prisma's Neon serverless
PostgreSQL adapter. It does not use D1 or import the Node/Fastify server. The Node application
continues to use Fastify through `src/server.ts`.

The Worker routes are implemented separately in `src/worker-api.ts`; keep them aligned with the
Fastify route modules when changing API behavior.

## Configure and deploy

1. Authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

2. Add the required secrets. Wrangler prompts for each value; do not put secret values in
   `wrangler.jsonc` or commit them:

   ```sh
   npx wrangler secret put DATABASE_URL
   npx wrangler secret put JWT_ACCESS_SECRET
   npx wrangler secret put JWT_REFRESH_SECRET
   ```

   Use Neon's pooled `DATABASE_URL` for the Worker. Set optional integration secrets the same
   way if those features are enabled.

3. Set `CORS_ORIGINS` in `wrangler.jsonc` under `vars` to the comma-separated, exact origins of
   the deployed admin and customer portals.

4. Apply the Prisma migrations to Neon from a trusted local environment:

   ```sh
   npm run db:deploy
   ```

   If the pooled URL cannot run migrations, temporarily use Neon's unpooled URL as
   `DATABASE_URL` for this command, then restore the pooled URL for the Worker.

5. Deploy:

   ```sh
   npm run deploy
   ```

The deployed health check is `/health`; API documentation is at `/docs` and `/openapi.json`.
For local Worker development, put the required environment values in an ignored `.dev.vars` file,
then run `npm run dev:worker`.

The build generates Prisma Client explicitly. If the deployment build reports that npm blocked
required install scripts, review and approve only the required Prisma/Wrangler package scripts
using the npm command shown in the build log.

## Runtime considerations

- Password hashes remain Argon2id and existing hashes remain verifiable. The Worker uses a
  WebAssembly implementation instead of Node's native Argon2 addon.
- Argon2id is CPU-intensive. Workers Free allows 10 ms CPU per request; password login and
  account creation are likely to exceed that. Use Workers Paid, whose default CPU limit is
  30 seconds, and monitor Worker CPU time.
- The Worker rate-limit counters are in memory and local to each isolate. They are not globally
  shared; configure Cloudflare-level rate limiting for production protection.
