// MitID BrowserClient - Node.js port
// Ported from https://github.com/Hundter/MitID-BrowserClient
import { createHash } from "crypto";
import { CustomSRP, createFlowValueProof, pad } from "./srp.js";

export interface MitIDClientOptions {
  baseUrl?: string;
}

interface CookieJar {
  [key: string]: string;
}

interface AuthSessionData {
  brokerSecurityContext: string;
  serviceProviderName: string;
  referenceTextHeader: string;
  referenceTextBody: string;
}

interface NextAuthenticator {
  authenticatorType: string;
  authenticatorSessionFlowKey: string;
  eafeHash: string;
  authenticatorSessionId: string;
}

interface NextData {
  nextAuthenticator: NextAuthenticator;
  combinations?: Array<{
    id: string;
    combinationItems: Array<{ name: string }>;
  }>;
  errors?: Array<{
    errorCode?: string;
    userMessage?: { text?: { text?: string } };
    message?: string;
  }>;
  nextSessionId?: string;
}

interface PollResponse {
  status: string;
  channelBindingValue?: string;
  confirmation?: boolean;
  payload?: {
    response: string;
    responseSignature: string;
  };
}

interface SrpInitResponse {
  srpSalt: { value: string };
  randomB: { value: string };
}

interface ProveResponse {
  m2: { value: string };
}

interface InitAuthResponse {
  pollUrl: string;
  ticket: string;
  errorCode?: string;
}

export type StatusCallback = (message: string) => void;

export interface Authenticators {
  [key: string]: string | undefined;
}

const DEFAULT_BASE_URL = "https://pp.mitid.dk";

export class MitIDClient {
  readonly baseUrl: string;
  private readonly coreUrl: string;
  private readonly appAuthUrl: string;
  cookies: CookieJar;

  private clientHash!: string;
  private authenticationSessionId!: string;
  private brokerSecurityContext!: string;
  private serviceProviderName!: string;
  private referenceTextHeader!: string;
  private referenceTextBody!: string;
  private userId!: string;
  private authenticatorType!: string;
  private authenticatorSessionFlowKey!: string;
  private authenticatorEafeHash!: string;
  private authenticatorSessionId!: string;
  private finalizationSessionId: string | undefined;

  constructor(options: MitIDClientOptions | string = {}) {
    const baseUrl =
      typeof options === "string" ? options : (options.baseUrl ?? DEFAULT_BASE_URL);
    this.baseUrl = baseUrl;
    this.coreUrl = `${baseUrl}/mitid-core-client-backend`;
    this.appAuthUrl = `${baseUrl}/mitid-code-app-auth`;
    this.cookies = {};
  }

  private async fetch(url: string, opts: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(opts.headers as Record<string, string> | undefined),
    };

    const cookieStr = Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
    if (cookieStr) headers["Cookie"] = cookieStr;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const resp = await fetch(url, {
      ...opts,
      headers,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const setCookies = resp.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      if (!pair) continue;
      const [name, ...rest] = pair.split("=");
      if (name) {
        this.cookies[name.trim()] = rest.join("=").trim();
      }
    }

    return resp;
  }

  async init(
    clientHash: string,
    authenticationSessionId: string,
  ): Promise<AuthSessionData> {
    this.clientHash = clientHash;
    this.authenticationSessionId = authenticationSessionId;

    const resp = await this.fetch(
      `${this.coreUrl}/v1/authentication-sessions/${authenticationSessionId}`,
    );
    if (!resp.ok) throw new Error(`Failed to get auth session: ${resp.status}`);

    const data = (await resp.json()) as AuthSessionData;
    this.brokerSecurityContext = data.brokerSecurityContext;
    this.serviceProviderName = data.serviceProviderName;
    this.referenceTextHeader = data.referenceTextHeader;
    this.referenceTextBody = data.referenceTextBody;

    return data;
  }

  async identifyAndGetAuthenticators(
    userId: string,
  ): Promise<Authenticators> {
    this.userId = userId;

    const idResp = await this.fetch(
      `${this.coreUrl}/v1/authentication-sessions/${this.authenticationSessionId}`,
      { method: "PUT", body: JSON.stringify({ identityClaim: userId }) },
    );
    if (!idResp.ok) {
      const err = await idResp.json().catch(() => ({} as Record<string, string>));
      throw new Error(
        `Failed to identify as ${userId}: ${(err as Record<string, string>).errorCode ?? String(idResp.status)}`,
      );
    }

    const nextResp = await this.fetch(
      `${this.coreUrl}/v2/authentication-sessions/${this.authenticationSessionId}/next`,
      { method: "POST", body: JSON.stringify({ combinationId: "" }) },
    );
    if (!nextResp.ok)
      throw new Error(`Failed to get authenticators: ${nextResp.status}`);

    const data = (await nextResp.json()) as NextData;
    if (
      data.errors?.length &&
      data.errors[0]?.errorCode === "control.authenticator_cannot_be_started"
    ) {
      throw new Error(
        data.errors[0]?.userMessage?.text?.text ?? "Cannot start authenticator",
      );
    }

    this.setAuthenticatorState(data);

    const combos: Authenticators = {};
    for (const c of data.combinations ?? []) {
      const name = c.id === "S3" ? "APP" : c.id === "S1" ? "TOKEN" : c.id;
      combos[name] = c.combinationItems[0]?.name;
    }
    return combos;
  }

  private setAuthenticatorState(data: NextData): void {
    const next = data.nextAuthenticator;
    this.authenticatorType = next.authenticatorType;
    this.authenticatorSessionFlowKey = next.authenticatorSessionFlowKey;
    this.authenticatorEafeHash = next.eafeHash;
    this.authenticatorSessionId = next.authenticatorSessionId;
  }

  private async selectAuthenticator(type: string): Promise<void> {
    if (this.authenticatorType === type) return;

    const combinationId =
      type === "APP" ? "S3" : type === "TOKEN" ? "S1" : type;
    const resp = await this.fetch(
      `${this.coreUrl}/v2/authentication-sessions/${this.authenticationSessionId}/next`,
      { method: "POST", body: JSON.stringify({ combinationId }) },
    );
    if (!resp.ok)
      throw new Error(`Failed to select authenticator: ${resp.status}`);

    const data = (await resp.json()) as NextData;
    if (data.errors?.length)
      throw new Error(data.errors[0]?.message ?? "Authenticator error");
    this.setAuthenticatorState(data);

    if (this.authenticatorType !== type) {
      throw new Error(
        `Could not select ${type}, got ${this.authenticatorType}`,
      );
    }
  }

  private createFlowValueProofData(): Buffer {
    const hashedBsc = createHash("sha256")
      .update(this.brokerSecurityContext, "utf-8")
      .digest("hex");
    const b64Header = Buffer.from(
      this.referenceTextHeader,
      "utf-8",
    ).toString("base64");
    const b64Body = Buffer.from(this.referenceTextBody, "utf-8").toString(
      "base64",
    );
    const b64SP = Buffer.from(this.serviceProviderName, "utf-8").toString(
      "base64",
    );

    return Buffer.from(
      [
        this.authenticatorSessionId,
        this.authenticatorSessionFlowKey,
        this.clientHash,
        this.authenticatorEafeHash,
        hashedBsc,
        b64Header,
        b64Body,
        b64SP,
      ].join(","),
      "utf-8",
    );
  }

  async authenticateWithApp(onStatus?: StatusCallback): Promise<void> {
    await this.selectAuthenticator("APP");
    const log = onStatus ?? console.log;

    // Init app auth - triggers push notification
    const initResp = await this.fetch(
      `${this.appAuthUrl}/v1/authenticator-sessions/web/${this.authenticatorSessionId}/init-auth`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (!initResp.ok)
      throw new Error(`Failed to init app auth: ${initResp.status}`);

    const initData = (await initResp.json()) as InitAuthResponse;
    if (initData.errorCode)
      throw new Error(`App auth error: ${initData.errorCode}`);

    const { pollUrl, ticket } = initData;
    log("Waiting for MitID app approval...");

    // Poll for approval
    let response: string;
    let responseSignature: string;
    while (true) {
      const pollResp = await this.fetch(pollUrl, {
        method: "POST",
        body: JSON.stringify({ ticket }),
      });
      const poll = (await pollResp.json()) as PollResponse;

      if (poll.status === "timeout") continue;
      if (poll.status === "channel_validation_otp") {
        log(`OTP code: ${poll.channelBindingValue}`);
        continue;
      }
      if (poll.status === "channel_validation_tqr") {
        log("QR code requested (scan in app)");
        continue;
      }
      if (poll.status === "channel_verified") {
        log("Verified, waiting for approval...");
        continue;
      }
      if (poll.status === "OK" && poll.confirmation === true) {
        if (!poll.payload) throw new Error("Missing payload in OK response");
        response = poll.payload.response;
        responseSignature = poll.payload.responseSignature;
        break;
      }

      throw new Error(`Unexpected poll status: ${poll.status}`);
    }

    log("Approved! Completing SRP...");

    // SRP flow
    const t1 = Date.now();
    const srp = new CustomSRP();
    const A = srp.srpStage1();
    const t1end = Date.now();

    const srpInitResp = await this.fetch(
      `${this.appAuthUrl}/v1/authenticator-sessions/web/${this.authenticatorSessionId}/init`,
      {
        method: "POST",
        body: JSON.stringify({ randomA: { value: A } }),
      },
    );
    if (!srpInitResp.ok) {
      const errBody = await srpInitResp.text().catch(() => "");
      throw new Error(`SRP init failed: ${srpInitResp.status} ${errBody}`);
    }

    const t2 = Date.now();
    const srpInit = (await srpInitResp.json()) as SrpInitResponse;
    const srpSalt = srpInit.srpSalt.value;
    const randomB = srpInit.randomB.value;

    // Derive password from app response + flow key
    const password = createHash("sha256")
      .update(
        Buffer.concat([
          Buffer.from(response, "base64"),
          Buffer.from(this.authenticatorSessionFlowKey, "utf-8"),
        ]),
      )
      .digest("hex");

    const m1 = srp.srpStage3(
      srpSalt,
      randomB,
      password,
      this.authenticatorSessionId,
    );

    // Flow value proof
    const proofData = this.createFlowValueProofData();
    const flowValueProof = createFlowValueProof(
      srp.kBits,
      "flowValues",
      proofData,
    );
    const t2end = Date.now();

    // Prove
    const proveResp = await this.fetch(
      `${this.appAuthUrl}/v1/authenticator-sessions/web/${this.authenticatorSessionId}/prove`,
      {
        method: "POST",
        body: JSON.stringify({
          m1: { value: m1 },
          flowValueProof: { value: flowValueProof },
        }),
      },
    );
    if (!proveResp.ok)
      throw new Error(`SRP prove failed: ${proveResp.status}`);

    const t3 = Date.now();
    const proveData = (await proveResp.json()) as ProveResponse;
    if (!srp.srpStage5(proveData.m2.value)) {
      throw new Error("M2 verification failed");
    }

    // Encrypt response signature
    const paddedSig = pad(responseSignature);
    const authEnc = srp
      .authEnc(Buffer.from(paddedSig, "base64"))
      .toString("base64");
    const t3end = Date.now();

    const frontEndTime = t1end - t1 + (t2end - t2) + (t3end - t3);

    // Verify
    const verifyResp = await this.fetch(
      `${this.appAuthUrl}/v1/authenticator-sessions/web/${this.authenticatorSessionId}/verify`,
      {
        method: "POST",
        body: JSON.stringify({
          encAuth: authEnc,
          frontEndProcessingTime: frontEndTime,
        }),
      },
    );
    if (verifyResp.status !== 204)
      throw new Error(`Verify failed: ${verifyResp.status}`);

    // Advance to finalization
    const finalNextResp = await this.fetch(
      `${this.coreUrl}/v2/authentication-sessions/${this.authenticationSessionId}/next`,
      { method: "POST", body: JSON.stringify({ combinationId: "" }) },
    );
    if (!finalNextResp.ok)
      throw new Error(`Failed to advance: ${finalNextResp.status}`);

    const finalNext = (await finalNextResp.json()) as NextData;
    if (finalNext.errors?.length)
      throw new Error(`Auth errors: ${JSON.stringify(finalNext.errors)}`);

    this.finalizationSessionId = finalNext.nextSessionId;
    log("Authentication complete");
  }

  async finalize(): Promise<string> {
    if (!this.finalizationSessionId)
      throw new Error("No finalization session");

    const resp = await this.fetch(
      `${this.coreUrl}/v1/authentication-sessions/${this.finalizationSessionId}/finalization`,
      { method: "PUT" },
    );
    if (!resp.ok) throw new Error(`Finalization failed: ${resp.status}`);

    const data = (await resp.json()) as { authorizationCode: string };
    return data.authorizationCode;
  }
}
