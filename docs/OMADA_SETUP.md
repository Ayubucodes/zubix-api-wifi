# Omada Setup (External Portal)

Source: TP-Link Omada support article 132060, "External Portal authentication".
It applies to Omada Controller v6.2.10 and later. Earlier versions have separate guides.

## Status

The client in `apps/api/src/integrations/omada/omada.client.ts` implements the
documented login and authorization calls. **It has not been tested against a
real controller.** Before go-live, check every item in "Verify before go-live".

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
4. **TLS.** Controllers often use a self-signed certificate. Trust it through
   `NODE_EXTRA_CA_CERTS`, not by disabling verification.
5. **Session timeout.** The article describes no idle timeout. The only
   expiry control is `time`. Enforce expiry in the application (see the
   expiration job, not yet built) rather than relying on the controller.

## Network setup (manual, in the Omada web UI)

These steps come from general Omada use, not from the article above. Confirm
the menu names on your controller version.

1. Create a site per physical location, and adopt each access point to it.
2. Create the SSID. Set its security to the captive portal / external portal
   option. Point the portal URL at your portal server (HTTPS).
3. Create a Hotspot Operator account and note its credentials for `.env`.
4. Restrict the portal return URL to your own domains.

## Not implemented yet

- Client disconnection / deauthorization (not described in the article above).
  Expiry should use the controller's own time limit where possible, and the
  application should record the outcome.
- Access point and client synchronization.
- Retry and expiry jobs.

## How the portal uses this

After a payment succeeds or a voucher is redeemed, the portal calls `POST /api/v1/public/connect` with the device details the controller put in the sign-in address (`clientMac`, `apMac`, `ssidName`, `radioId`) and the subscription id it was given. The API checks that the subscription is active, enforces the pass's device limit, then calls the controller's authorize endpoint for the remaining time.

If `OMADA_CONTROLLER_URL`, `OMADA_USERNAME` and `OMADA_PASSWORD` are not set, the endpoint answers `NOT_CONFIGURED` and the portal tells the customer to ask staff. Nothing is faked.

Before going live, confirm on your controller: the login and authorize paths, whether `time` is milliseconds or microseconds, that the client IP the API sees is the customer's LAN address, and that the portal and API hosts are in the walled garden (pre-authentication access list).
