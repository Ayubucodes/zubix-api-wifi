# Payment Setup

Only providers with documentation we could read are listed. Nothing here has
been tested with live money. ClickPesa does not provide a sandbox: credential
rotation, API calls, and any payment test must be done carefully against
production.

## ClickPesa USSD push (implemented, not tested with a live account)

Documentation: https://docs.clickpesa.com

Documented facts (checked against the official docs):

- **No sandbox.** Every API call goes to production. Test with a small amount
  and your own phone only, once KYC is approved.
- **KYC approval is required** before token generation works.
- **Token:** `POST https://api.clickpesa.com/third-parties/generate-token` with
  headers `client-id` and `api-key`. The token is valid for 1 hour and rate
  limited to one request per client ID per IP every 3 minutes. The adapter
  caches it.
- **USSD push:** `POST https://api.clickpesa.com/third-parties/payments/initiate-ussd-push-request`
  with `Authorization: <token>` (the token already includes `Bearer`). Body:
  `amount` (string), `currency` (`TZS`), `orderReference` (alphanumeric, max 20
  characters, must be unique), `phoneNumber` (digits, with country code, no `+`),
  and `checksum` if checksum is enabled on your account.
- **Statuses:** `PROCESSING`, `SUCCESS`, `FAILED`, `SETTLED`.
- **Webhook:** The Worker accepts the URL already configured in your ClickPesa
  dashboard, `https://api.zubix.win/api/payments/webhook/clickpesa`, as well
  as `https://api.zubix.win/api/v1/payments/webhooks/CLICKPESA`. Application
  webhooks apply to Collection API transactions; merchant-level callbacks are
  fallback only when an application webhook is not configured. The endpoint
  verifies ClickPesa's HMAC checksum and returns 2xx after it processes the
  callback.
- **Failure callbacks:** `PAYMENT FAILED` callbacks do not include the
  collected amount. The adapter verifies the checksum and marks only the
  payment identified by its order reference as failed.
- **Status query:** ClickPesa documents `GET
  /payments/{orderReference}`. The API checks this endpoint when a pending or
  processing ClickPesa payment is polled, and activates the subscription only
  when the returned amount and currency match the order. The query is
  throttled per payment to once every 10 seconds per warm Worker isolate;
  webhooks remain the primary update mechanism.
- **Other webhook events:** `PAYMENT INITIATED`, `PAYMENT REFUNDED`, and
  `PAYMENT REVERSED` are acknowledged as ignored events. They do not activate a
  subscription, change payment status, or disconnect a device. Configure
  `PAYMENT RECEIVED` (and optionally `PAYMENT FAILED`) for this integration.
  Refund/reversal handling and Omada disconnection are not implemented.
- **Checksum:** HMAC-SHA256, lowercase hex. Computed over the payload with
  `checksum` and `checksumMethod` removed and keys sorted at every level,
  compact JSON.

Open items, to confirm with ClickPesa before go-live:

1. **Checksum secret.** Obtain the checksum secret in the ClickPesa application
   settings and enable checksum signing. The webhook adapter intentionally
   rejects unsigned callbacks; do not disable verification in production.
2. **Webhook IP allow-list and retry policy.** Not stated in the pages reviewed.
3. **Checksum test vector.** The adapter's tests check it against itself. Get a
   known-good example from ClickPesa and add it as a test.

After you deploy the secrets and webhook, enable ClickPesa in the admin API
with a user that has `settings:manage`:

```http
PATCH /api/v1/settings/payment-providers/CLICKPESA
Content-Type: application/json

{"enabled": true}
```

The provider is disabled by default (including after a fresh seed). Do not
enable it until the credentials and checksum secret are present and the
application webhook is configured.

## Captive-portal API calls

The portal should request available packages from
`GET https://api.zubix.win/api/v1/public/packages`. To start a ClickPesa push,
send the selected package ID and payer's Tanzanian phone number:

```http
POST https://api.zubix.win/api/v1/payments/initiate
Content-Type: application/json
Idempotency-Key: <unique key for this purchase attempt>

{"packageId":"<package UUID>","phoneNumber":"0712345678","providerCode":"CLICKPESA"}
```

The API looks up the package price itself and returns a payment with a
reference and status. Show the customer that a USSD prompt is being sent, then
poll `GET /api/v1/payments/status/{reference}` until it returns `SUCCESS` or
`FAILED`. On `SUCCESS`, the response includes `subscriptionId`; only then call
`POST /api/v1/public/connect` with that ID and the device information from the
Omada redirect, including `clientIp`. Do not treat a successful initiation
response as proof of payment. ClickPesa has no sandbox, so testing this flow
sends a real production payment prompt; use your own phone and a low-priced
package.

The API cannot check a customer's mobile-money balance before asking ClickPesa
to initiate the payment. If ClickPesa rejects a push because the wallet has
insufficient funds, the initiation endpoint returns a customer-friendly error
and includes the failed payment reference in `error.details.reference`. The
portal should show that message and let the customer top up or use another
number; it must not claim the payment succeeded.

## Selcom (NOT implemented)

The only documentation found was a third-party Node.js SDK
(`selcom-developers.github.io/node-selcom`), which does not say it is official.
It describes the header scheme (`Authorization: SELCOM <base64 key>`,
`Timestamp`, `Digest-Method`, `Digest`, `Signed-Fields`) but its own examples
disagree, and it gives no base URLs. An adapter built on that would be a guess.

To proceed, get the official Selcom API documentation and sandbox credentials
from Selcom Support, then the adapter can be written against it.

## Mock provider (development only)

`MOCK` simulates payments for local development. It is refused when
`APP_ENV=production`. Its webhooks use HMAC-SHA256 with a local secret, so the
same verification code runs as in production. It never moves money.

## Environment variables

```
CLICKPESA_BASE_URL=https://api.clickpesa.com/third-parties
CLICKPESA_CLIENT_ID=
CLICKPESA_API_KEY=            # sent as the "api-key" header
CLICKPESA_CHECKSUM_SECRET=
```

For local development, store values in the ignored `.env`. For production,
add them as Cloudflare Worker secrets rather than putting them in
`wrangler.jsonc`. The legacy `CLICKPESA_CLIENT_SECRET` name is still accepted,
but use `CLICKPESA_API_KEY` for new deployments. The Worker caches its
authorization token in each warm isolate; ClickPesa permits only one token
mint per client ID and source IP every three minutes, so do not rotate secrets
by making repeated token requests as a test strategy.
