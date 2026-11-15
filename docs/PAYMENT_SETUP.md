# Payment Setup

Only providers with documentation we could read are listed. Nothing here has
been tested with live money.

## ClickPesa (adapter written, not tested with a live account)

Documentation: https://docs.clickpesa.com

Documented facts (checked against the official docs):

- **No sandbox.** Every API call goes to production. Test with a small amountt
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
- **Webhook:** HTTP POST. The event is `PAYMENT RECEIVED`. The amount is in
  `data.collectedAmount`, the reference in `data.orderReference`, the status in
  `data.status`. The endpoint must answer 2xx. That only means it was received,
  not processed.
- **Checksum:** HMAC-SHA256, lowercase hex. Computed over the payload with
  `checksum` and `checksumMethod` removed and keys sorted at every level,
  compact JSON.

Open items, to confirm with ClickPesa before go-live:

1. **Transaction status query endpoint.** Not found in the pages reviewed.
   Without it, a missed webhook cannot be reconciled automatically. Ask
   ClickPesa support or check the API reference.
2. **Where the checksum secret comes from.** The docs say "your merchant's
   checksum secret key" but don't say where to get it. Set
   `CLICKPESA_CHECKSUM_SECRET` once you have it.
3. **Webhook IP allow-list and retry policy.** Not stated in the pages reviewed.
4. **Checksum test vector.** The adapter's tests check it against itself. Get a
   known-good example from ClickPesa and add it as a test.

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
CLICKPESA_CLIENT_SECRET=      # this is the API key sent as "api-key"
CLICKPESA_CHECKSUM_SECRET=
```

Note: `.env.example` names the ClickPesa key `CLICKPESA_CLIENT_SECRET`. It is
sent to ClickPesa as the `api-key` header.
