// MitID login flow orchestration (OAuth redirects, Criipto bootstrap, cookie extraction)
// Ported from https://github.com/Hundter/MitID-BrowserClient
import { MitIDClient } from "./client.js";

export type LoginStatusCallback = (message: string) => void;

interface CookieJar {
  [key: string]: string;
}

interface RedirectResult {
  finalUrl: string;
  body: string;
  cookies: CookieJar;
  visited: Array<{ url: string; status: number }>;
  status: number;
}

interface BootstrapData {
  screen?: {
    rendition?: {
      coreClientScriptSource?: string;
      cancelUrl?: string;
    };
  };
}

interface CoreClientData {
  CoreClientAux: string;
  CallbackEndpoint: string;
  ExchangeEndpoint: string;
}

interface CoreClientAux {
  coreClient: { checksum: string };
  parameters: {
    authenticationSessionId: string;
    apiUrl: string;
  };
}

export interface LoginResult {
  cookies: CookieJar;
  finalUrl: string;
}

async function followRedirects(
  url: string,
  cookies: CookieJar = {},
): Promise<RedirectResult> {
  const visited: Array<{ url: string; status: number }> = [];
  let currentUrl = url;

  for (let i = 0; i < 15; i++) {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    const resp = await fetch(currentUrl, {
      redirect: "manual",
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
    });

    const setCookies = resp.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(";");
      if (!pair) continue;
      const [name, ...rest] = pair.split("=");
      if (name) {
        cookies[name.trim()] = rest.join("=").trim();
      }
    }

    visited.push({ url: currentUrl, status: resp.status });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) throw new Error("Redirect without location header");
      if (location.startsWith("/")) {
        const u = new URL(currentUrl);
        currentUrl = `${u.protocol}//${u.host}${location}`;
      } else {
        currentUrl = location;
      }
      continue;
    }

    return {
      finalUrl: currentUrl,
      body: await resp.text(),
      cookies,
      visited,
      status: resp.status,
    };
  }

  throw new Error("Too many redirects");
}

export async function login(
  username: string,
  serviceLoginUrl: string,
  onStatus?: LoginStatusCallback,
): Promise<LoginResult> {
  const log = onStatus ?? console.log;

  // Step 1: Follow redirects from service login to Criipto broker
  log("Following OAuth redirects...");
  const { finalUrl, body, cookies } = await followRedirects(serviceLoginUrl);

  // Step 2: Extract the CoreClient URL from the broker page
  const bootstrapMatch = body.match(/data-bootstrap="([^"]+)"/);
  if (!bootstrapMatch)
    throw new Error("Could not find bootstrap data in broker page");

  const bootstrapData = JSON.parse(
    bootstrapMatch[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
  ) as BootstrapData;
  const coreClientUrl =
    bootstrapData.screen?.rendition?.coreClientScriptSource;

  if (!coreClientUrl) throw new Error("Could not find CoreClient URL");

  // Step 3: Fetch CoreClient JSON to get aux
  log("Fetching MitID session...");
  const ccResp = await fetch(coreClientUrl, {
    headers: {
      Accept: "application/json",
      Origin: new URL(finalUrl).origin,
      Referer: finalUrl,
    },
  });
  if (!ccResp.ok)
    throw new Error(`CoreClient fetch failed: ${ccResp.status}`);

  const ccData = (await ccResp.json()) as CoreClientData;
  const aux = JSON.parse(
    Buffer.from(ccData.CoreClientAux, "base64").toString("utf-8"),
  ) as CoreClientAux;
  const callbackUrl = ccData.CallbackEndpoint;

  const clientHash = Buffer.from(aux.coreClient.checksum, "base64").toString(
    "hex",
  );
  const authSessionId = aux.parameters.authenticationSessionId;
  const apiBaseUrl = aux.parameters.apiUrl.replace(
    /\/mitid-core-client-backend\/v1\/$/,
    "",
  );

  log(`Session: ${authSessionId}`);

  // Step 4: Run MitID BrowserClient auth
  const client = new MitIDClient({ baseUrl: apiBaseUrl });
  Object.assign(client.cookies, cookies);
  await client.init(clientHash, authSessionId);

  const authenticators = await client.identifyAndGetAuthenticators(username);
  log(`Available authenticators: ${Object.keys(authenticators).join(", ")}`);

  if (!authenticators["APP"])
    throw new Error("APP authenticator not available for this user");

  await client.authenticateWithApp(log);
  const authCode = await client.finalize();
  log(`Auth code: ${authCode.substring(0, 8)}...`);

  // Step 5: Exchange auth code via Criipto callback
  log("Exchanging auth code...");
  const cbUrl = new URL(callbackUrl);
  cbUrl.searchParams.set("code", authCode);

  const final = await followRedirects(cbUrl.href, cookies);
  log("Login complete!");
  return {
    cookies: final.cookies,
    finalUrl: final.finalUrl,
  };
}
