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
   way if those features are enabled. For ClickPesa, set `CLICKPESA_BASE_URL`
   to `https://api.clickpesa.com/third-parties` in `vars`, then add
   `CLICKPESA_CLIENT_ID`, `CLICKPESA_API_KEY`, and `CLICKPESA_CHECKSUM_SECREtT`
   as Worker secrets. For Omada, add `OMADA_CONTROLLER_URL`, `OMADA_USERNAME`,
   `OMADA_PASSWORD`, `OMADA_ACCESS_CLIENT_ID`, and
   `OMADA_ACCESS_CLIENT_SECRET` as secrets when using the protected Cloudflare
   Tunnel setup. See `docs/OMADA_SETUP.md` for the controller/server topology.
   The payment API key, checksum secret, and Access service-token secret must
   not go in `wrangler.jsonc`.

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

- Password hashes remain Argon2id and existing hashes remain verifiable. The Worker uses the
  pure-JavaScript `@noble/hashes` implementation because Cloudflare Workers disallows runtime
  compilation of the embedded WebAssembly used by `hash-wasm`.
- Argon2id is CPU-intensive, especially in pure JavaScript. Workers Free allows 10 ms CPU per
  request, so login and account creation are likely to exceed that. Use Workers Paid and monitor
  CPU time.
- The Worker creates and disconnects a Neon Prisma client for each request. Neon WebSocket pools
  must not be reused across Worker request contexts.
- The Worker rate-limit counters are in memory and local to each isolate. They are not globally
  shared; configure Cloudflare-level rate limiting for production protection.
