# Omada Setup (External Portal)

Source: TP-Link Omada support article 132060, "External Portal authentication".
It applies to Omada Controller v6.2.10 and later. Earlier versions have separate guides.

## Status

The client in `src/integrations/omada/omada.client.ts` implements the
documented login and authorization calls. **It has not been tested against a
real controller.** Before go-live, check every item in "Verify before go-live".

## Where Omada Controller runs

Omada Controller is a separate, always-on application. Install it on a
supported server or computer using TP-Link's [Omada Controller download page](https://support.omadanetworks.com/us/download/software/omada-controller/).
It does not run inside Cloudflare Workers. The Worker runs the Zubix API and
sends HTTPS requests to the controller when a paid device needs authorization.

The flow is:

1. The customer's device joins the Omada Wi-Fi and is redirected to your
   captive portal.
2. The portal starts payment through the Zubix Worker at `api.zubix.win`.
3. ClickPesa sends the result to the Worker. The portal receives the active
   subscription from the payment-status endpoint.
4. The portal sends the subscription and Omada client details to the Worker.
5. The Worker calls Omada Controller to authorize that device until the
   package expires.

## Recommended private-controller connection

If Omada Controller is on a private server or LAN, use `cloudflared` on that
server to create a Cloudflare Tunnel hostname for the controller's HTTPS API.
Protect that hostname with a Cloudflare Access **Service Auth** policy and a
service token. Do not port-forward the controller's management interface to
the public internet.

Set `OMADA_CONTROLLER_URL` to the tunnel hostname's base URL (for example
`https://omada-api.example.com`, without `/api/v2/hotspot/...`). Set
`OMADA_ACCESS_CLIENT_ID` and `OMADA_ACCESS_CLIENT_SECRET` to the service-token
values as Worker secrets. The API sends those Access headers when it calls
Omada. Also set `OMADA_USERNAME` and `OMADA_PASSWORD` to a dedicated Omada
Hotspot Operator's credentials. The Access service token and Omada operator
credentials are separate credentials and both are needed.

Configure the tunnel's local service to the controller's actual HTTPS API
address and port, as shown by your Omada Controller installation. Confirm
that the HTTPS certificate is trusted and that the login/authorization paths
work through the tunnel before enabling paid access. `OMADA_CONTROLLER_URL`
must not be a private IP or `localhost` when configured in the Worker.

## How the captive portal flow works (documented)

1. A client joins the SSID. The access point (EAP) intercepts its first HTTP
   request and redirects it to the Controller.
2. The Controller returns an HTTP 302 to your External Portal Server, with the
   client details in the query string:
   - Access point: client MAC, client IP, AP MAC, SSID name, radio ID
     (0 = 2.4 GHz, 1 = 5 GHz), site ID, redirect URL, timestamp in milliseconds.
   - Gateway (wired): client MAC, gateway MAC, VLAN ID, site ID, redirect URL,
     timestamp.
3. Your portal must keep these parameters and send them back to the
   Controller when it authorizes the client.

The portal's `POST https://api.zubix.win/api/v1/public/connect` request must
include `clientIp` from the Omada redirect parameters along with
`subscriptionId`, `clientMac`, `apMac`, `ssidName`, and `radioId`. The Worker
cannot use the HTTP request's observed IP as the device address: Cloudflare
sees the customer's public/NAT address, while Omada needs the LAN address
assigned by the access point or gateway.

## Authorization calls (documented)

1. **Operator login.** POST JSON `{ "name": "...", "password": "..." }`. Use a
   **Hotspot Operator** account, not a controller administrator. The response
   carries a token, which is sent as the `Csrf-Token` header on later requests.
   The Controller also sets a session cookie: `TPOMADA_SESSIONID` (v5.11+) or
   `TPEAP_SESSIONID` (older). Store it and send it back.
2. **Authorize client.** POST JSON with:
   - Common: `clientMac`, `clientIp`, `time` (expiration in ms), `authType`
     (always `4`), `totalTrafficLimitBytes`, `downloadRateLimitKbps`,
     `uploadRateLimitKbps`
   - Access point: `apMac`, `ssidName`, `radioId`
   - Gateway: `gatewayMac`, `vid`
   - Success: `{"errorCode": 0}`

## Verify before go-live

1. **Endpoint paths.** The article gives `/api/v2/hotspot/login` and
   `/api/v2/hotspot/extPortal/auth`, but its code samples swap them. The
   client takes both paths from configuration. Check on your controller which
   path accepts login and which accepts authorization.
2. **Meaning of `time`.** The article says "expiration in milliseconds". It
   does not say whether this is an absolute epoch timestamp or a duration.
   Test one authorization with a short window and check the expiry on the
   controller.
3. **Site identifier.** The article's examples don't show where the site ID goes
   in the authorization call. Confirm whether the path or body needs it.
4. **TLS.** The controller endpoint must use a certificate trusted by the
   Cloudflare Worker runtime. Do not disable certificate verification.
5. **Session timeout.** The article describes no idle timeout. The only
   expiry control is `time`. Enforce expiry in the application (see the
   expiration job, not yet built) rather than relying on the controller.

## Network setup (manual, in the Omada web UI)

These steps come from general Omada use, not from the article above. Confirm
the menu names on your controller version.

1. Create a site per physical location, and adopt each access point to it.
2. Create the SSID. Set its security to the captive portal / external portal
   option. Point the portal URL at your portal server (HTTPS).
3. Create a Hotspot Operator account (not a controller administrator) and store
   its credentials as Worker secrets.
4. Set the External Portal URL to your captive portal's HTTPS URL, and allow
   the portal and `api.zubix.win` in the pre-authentication/walled-garden list
   so users can reach the payment and connect endpoints before authorization.
5. Restrict the portal return URL to your own domains.

## Not implemented yet

- Client disconnection / deauthorization (not described in the article above).
  Expiry should use the controller's own time limit where possible, and the
  application should record the outcome.
- Access point and client synchronization.
- Retry and expiry jobs.

## How the portal uses this

After a payment succeeds or a voucher is redeemed, the portal polls the payment status (or redemption response) until it has the `subscriptionId`, then calls `POST /api/v1/public/connect` with the device details the controller put in the sign-in address (`clientMac`, `clientIp`, `apMac`, `ssidName`, `radioId`) and that subscription id. The API checks that the subscription is active, enforces the pass's device limit, then calls the controller's authorize endpoint for the remaining time. The captive portal must run this call; a payment webhook alone does not know which device to authorize.

If `OMADA_CONTROLLER_URL`, `OMADA_USERNAME` and `OMADA_PASSWORD` are not set, the endpoint answers `NOT_CONFIGURED` and the portal tells the customer to ask staff. Nothing is faked.

## Cloudflare Worker reachability

The Worker must be able to reach `OMADA_CONTROLLER_URL` over HTTPS. A controller
available only at a private LAN address (for example `192.168.x.x`) is not
reachable directly from a Cloudflare Worker; use the protected Tunnel setup
above. The controller's TLS certificate must be trusted by the Worker runtime.

Before going live, confirm on your controller: the login and authorize paths,
whether `time` is milliseconds or microseconds, that the portal forwards the
client's LAN IP from the Omada redirect, and that the portal and API hosts are
in the walled garden (pre-authentication access list).
