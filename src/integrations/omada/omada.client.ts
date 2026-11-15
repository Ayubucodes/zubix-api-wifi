/**
 * Client for the Omada Controller External Portal API (Controller v6.2.10+).
 *
 * Source: TP-Link Omada support article 132060 (External Portal authentication).
 *
 * UNVERIFIED ON HARDWARE. The article lists the login path as "/api/v2/hotspot/login" and the
 * authorization path as "/api/v2/hotspot/extPortal/auth", but its own code samples swap them.
 * The paths below are therefore configurable. Confirm them on your controller before go-live.
 *
 * Open question: the article says `time` is the "expiration in milliseconds" without saying
 * whether it is an absolute epoch timestamp or a duration. This client sends the value the
 * caller provides. Confirm the meaning on your controller.
 */

export class OmadaError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly controllerErrorCode?: number;

  constructor(message: string, options: { retryable: boolean; status?: number; controllerErrorCode?: number }) {
    super(message);
    this.name = "OmadaError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.controllerErrorCode = options.controllerErrorCode;
  }
}

export interface OmadaClientConfig {
  baseUrl: string;
  operatorName: string;
  operatorPassword: string;
  verifySsl?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  paths?: { login: string; authorize: string };
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface AuthorizeClientInput {
  clientMac: string;
  clientIp: string;
  /** Per the article: expiration in milliseconds. See the open question above. */
  time: number;
  apMac: string;
  ssidName: string;
  radioId: 0 | 1;
  totalTrafficLimitBytes?: number;
  downloadRateLimitKbps?: number;
  uploadRateLimitKbps?: number;
}

interface PortalSession {
  cookie: string;
  csrfToken: string;
}

const DEFAULT_PATHS = {
  login: "/api/v2/hotspot/login",
  authorize: "/api/v2/hotspot/extPortal/auth",
};

export class OmadaClient {
  private session: PortalSession | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly paths: { login: string; authorize: string };

  constructor(private readonly config: OmadaClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.paths = config.paths ?? DEFAULT_PATHS;
  }

  /** Authenticates as a Hotspot Operator (not a controller administrator). */
  async login(): Promise<void> {
    const response = await this.request(this.paths.login, {
      method: "POST",
      body: { name: this.config.operatorName, password: this.config.operatorPassword },
    });

    const body = (await response.json().catch(() => ({}))) as {
      errorCode?: number;
      result?: { token?: string };
      token?: string;
    };
    if (body.errorCode !== undefined && body.errorCode !== 0) {
      throw new OmadaError("Omada operator login was rejected", {
        retryable: false,
        status: response.status,
        controllerErrorCode: body.errorCode,
      });
    }

    const csrfToken = body.result?.token ?? body.token;
    const cookie = extractPortalCookie(response);
    if (!csrfToken || !cookie) {
      throw new OmadaError("Omada login response did not include a token and session cookie", {
        retryable: false,
        status: response.status,
      });
    }
    this.session = { cookie, csrfToken };
  }

  /** Authorizes a client. Logs in first if needed and re-logs in once if the session expired. */
  async authorizeClient(input: AuthorizeClientInput): Promise<void> {
    if (!this.session) {
      await this.login();
    }

    const payload = {
      clientMac: input.clientMac,
      clientIp: input.clientIp,
      time: input.time,
      authType: 4,
      totalTrafficLimitBytes: input.totalTrafficLimitBytes ?? 0,
      downloadRateLimitKbps: input.downloadRateLimitKbps ?? 0,
      uploadRateLimitKbps: input.uploadRateLimitKbps ?? 0,
      apMac: input.apMac,
      ssidName: input.ssidName,
      radioId: input.radioId,
    };

    let response = await this.request(this.paths.authorize, { method: "POST", body: payload, authenticated: true });
    if (response.status === 401 || response.status === 403) {
      this.session = null;
      await this.login();
      response = await this.request(this.paths.authorize, { method: "POST", body: payload, authenticated: true });
    }

    const body = (await response.json().catch(() => ({}))) as { errorCode?: number };
    if (body.errorCode !== 0) {
      throw new OmadaError("Omada rejected the client authorization", {
        retryable: false,
        status: response.status,
        controllerErrorCode: body.errorCode,
      });
    }
  }

  private async request(
    path: string,
    options: { method: "POST"; body: unknown; authenticated?: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (options.authenticated && this.session) {
      headers.cookie = this.session.cookie;
      headers["Csrf-Token"] = this.session.csrfToken;
    }

    let attempt = 0;
    for (;;) {
      try {
        const response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
          method: options.method,
          headers,
          body: JSON.stringify(options.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (response.status >= 500 && attempt < this.maxRetries) {
          attempt += 1;
          await this.sleep(backoffMs(attempt));
          continue;
        }
        return response;
      } catch (error) {
        if (attempt >= this.maxRetries) {
          throw new OmadaError(`Omada controller unreachable: ${(error as Error).message}`, { retryable: true });
        }
        attempt += 1;
        await this.sleep(backoffMs(attempt));
      }
    }
  }
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

function extractPortalCookie(response: Response): string | null {
  const cookies = response.headers.getSetCookie();
  for (const raw of cookies) {
    const pair = raw.split(";")[0]?.trim();
    if (pair && (pair.startsWith("TPOMADA_SESSIONID=") || pair.startsWith("TPEAP_SESSIONID="))) {
      return pair;
    }
  }
  return null;
}
