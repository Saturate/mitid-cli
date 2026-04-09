// MitID Code App Simulator API
// Auto-approve pending MitID transactions via the test simulator

export type SimulatorStatusCallback = (message: string) => void;

const DEFAULT_BASE_URL = "https://pp.mitid.dk";
const SIMULATOR_PIN = "112233";

interface AuthKeyResponse {
  authKey: string;
  timestamp: string;
}

interface PullMessage {
  datagram?: string;
  msg?: string;
}

interface PullResponse {
  status?: string;
  ticket?: string;
  msg?: PullMessage;
}

interface PerformAuthResponse {
  response: string;
  signedResponse: string;
  serviceProviderName?: string;
}

async function sim(
  method: string,
  url: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const opts: RequestInit = {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return resp.json();
}

export async function approve(
  uuid: string,
  authId: string,
  baseUrl: string = DEFAULT_BASE_URL,
  onStatus?: SimulatorStatusCallback,
): Promise<void> {
  const log = onStatus ?? console.log;
  const simApi = `${baseUrl}/mitid-test-api/v4/identities`;
  const base = `${simApi}/${uuid}/authenticators/code-app`;

  log("Waiting for MitID transaction...");

  for (let attempt = 0; attempt < 90; attempt++) {
    const authKeyResp = (await sim(
      "GET",
      `${base}/simulator/${authId}/auth-key`,
    )) as AuthKeyResponse;
    const { authKey, timestamp } = authKeyResp;

    const pull = (await sim(
      "POST",
      `${base}/${authId}/simulator-notifier/pull`,
      {
        authkey: authKey,
        timestamp,
      },
    )) as PullResponse;

    if (pull.status === "NOTFOUND" || !pull.ticket) {
      process.stdout.write(`\r  Polling... (${attempt * 2}s)`);
      await new Promise<void>((r) => setTimeout(r, 2000));
      continue;
    }

    log("\n  Transaction found!");

    if (!pull.msg?.datagram || !pull.msg?.msg) {
      // Direct confirm without perform-auth
      await sim("POST", `${base}/${authId}/simulator-notifier/confirm`, {
        ticket: pull.ticket,
        confirmed: true,
        payload: {},
        authKey,
        timestamp,
      });
      log("  APPROVED\n");
      return;
    }

    // Perform auth (sign the transaction)
    const authData = (await sim(
      "POST",
      `${base}/${authId}/simulator-notifier/perform-auth`,
      {
        pIN: SIMULATOR_PIN,
        datagram: pull.msg.datagram,
        msg: pull.msg.msg,
        ticket: pull.ticket,
      },
    )) as PerformAuthResponse;

    if (authData.serviceProviderName) {
      try {
        log(
          `  Service:  ${Buffer.from(authData.serviceProviderName, "base64").toString("utf-8")}`,
        );
      } catch {
        log(`  Service:  ${authData.serviceProviderName}`);
      }
    }

    // Fresh auth key for confirm
    const freshKey = (await sim(
      "GET",
      `${base}/simulator/${authId}/auth-key`,
    )) as AuthKeyResponse;

    await sim("POST", `${base}/${authId}/simulator-notifier/confirm`, {
      ticket: pull.ticket,
      confirmed: true,
      payload: {
        response: authData.response,
        responseSignature: authData.signedResponse,
      },
      authKey: freshKey.authKey,
      timestamp: freshKey.timestamp,
    });

    log("  APPROVED\n");
    return;
  }

  throw new Error("Timed out waiting for transaction (180s)");
}
