// MitID broker/provider adapters
// Each provider knows how to extract the auth session from its broker page
// and how to exchange the auth code back for a session

export interface CookieJar {
  [key: string]: string;
}

export interface ProviderSession {
  clientHash: string;
  authenticationSessionId: string;
  apiBaseUrl: string;
  cookies: CookieJar;
  exchange: (authCode: string, cookies: CookieJar) => Promise<{
    redirectUrl: string;
  }>;
}

export interface Provider {
  name: string;
  detect: (url: string, body: string) => boolean;
  bootstrap: (
    url: string,
    body: string,
    cookies: CookieJar,
  ) => Promise<ProviderSession>;
}

// --- Criipto (used by DCC, NORRIQ, and other Criipto customers) ---

interface CriiptoBootstrapData {
  screen?: {
    rendition?: {
      coreClientScriptSource?: string;
    };
  };
}

interface CriiptoClientData {
  CoreClientAux: string;
  CallbackEndpoint: string;
}

interface AuxData {
  coreClient: { checksum: string };
  parameters: {
    authenticationSessionId: string;
    apiUrl: string;
  };
}

const criipto: Provider = {
  name: "Criipto",

  detect: (url, body) =>
    url.includes("criipto") ||
    url.includes("idura.broker") ||
    body.includes("coreClientScriptSource"),

  async bootstrap(url, body, cookies) {
    const bootstrapMatch = body.match(/data-bootstrap="([^"]+)"/);
    if (!bootstrapMatch) throw new Error("Could not find Criipto bootstrap data");

    const data = JSON.parse(
      bootstrapMatch[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    ) as CriiptoBootstrapData;

    const coreClientUrl = data.screen?.rendition?.coreClientScriptSource;
    if (!coreClientUrl) throw new Error("Could not find CoreClient URL in Criipto page");

    const ccResp = await fetch(coreClientUrl, {
      headers: {
        Accept: "application/json",
        Origin: new URL(url).origin,
        Referer: url,
      },
    });
    if (!ccResp.ok) throw new Error(`Criipto CoreClient fetch failed: ${ccResp.status}`);

    const ccData = (await ccResp.json()) as CriiptoClientData;
    const aux = JSON.parse(
      Buffer.from(ccData.CoreClientAux, "base64").toString("utf-8"),
    ) as AuxData;

    const callbackUrl = ccData.CallbackEndpoint;

    return {
      clientHash: Buffer.from(aux.coreClient.checksum, "base64").toString("hex"),
      authenticationSessionId: aux.parameters.authenticationSessionId,
      apiBaseUrl: aux.parameters.apiUrl.replace(/\/mitid-core-client-backend\/v1\/$/, ""),
      cookies,
      exchange: async (authCode: string, exchangeCookies: CookieJar) => {
        const cbUrl = new URL(callbackUrl);
        cbUrl.searchParams.set("code", authCode);
        return { redirectUrl: cbUrl.href };
      },
    };
  },
};

// --- NemLog-in (borger.dk, skat.dk, e-boks, mit.dk, etc.) ---

const nemlogin: Provider = {
  name: "NemLog-in",

  detect: (url, body) =>
    url.includes("nemlog-in.mitid.dk") ||
    (body.includes("__RequestVerificationToken") && body.includes('"Aux"')),

  async bootstrap(url, body, cookies) {
    // Extract __RequestVerificationToken from hidden form input
    const tokenMatch = body.match(
      /name="__RequestVerificationToken"[^>]*value="([^"]+)"/,
    );
    if (!tokenMatch) throw new Error("Could not find RequestVerificationToken in NemLog-in page");
    const verificationToken = tokenMatch[1]!;

    // Extract Aux from inline JS: "Aux":"<base64>"
    const auxMatch = body.match(/"Aux"\s*:\s*"([^"]+)"/);
    if (!auxMatch) throw new Error("Could not find Aux in NemLog-in page");

    const aux = JSON.parse(
      Buffer.from(auxMatch[1]!, "base64").toString("utf-8"),
    ) as AuxData;

    const postbackUrl = url; // NemLog-in posts back to the same URL

    return {
      clientHash: Buffer.from(aux.coreClient.checksum, "base64").toString("hex"),
      authenticationSessionId: aux.parameters.authenticationSessionId,
      apiBaseUrl: aux.parameters.apiUrl.replace(/\/mitid-core-client-backend\/v1\/$/, ""),
      cookies,
      exchange: async (authCode: string, exchangeCookies: CookieJar) => {
        // NemLog-in expects a form POST with the auth code
        const cookieStr = Object.entries(exchangeCookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; ");

        const resp = await fetch(postbackUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Cookie: cookieStr,
          },
          body: `__RequestVerificationToken=${encodeURIComponent(verificationToken)}&MitIDAuthCode=${encodeURIComponent(authCode)}`,
          redirect: "manual",
        });

        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get("location");
          if (!location) throw new Error("NemLog-in redirect without location header");
          return { redirectUrl: location };
        }

        // Response is HTML with a SAML form; extract action URL
        const respBody = await resp.text();
        const actionMatch = respBody.match(/action="([^"]+)"/);


        if (actionMatch) {
          // SAML form - extract RelayState and SAMLResponse, build redirect
          const relayMatch = respBody.match(/name="RelayState"[^>]*value="([^"]+)"/);
          const samlMatch = respBody.match(/name="SAMLResponse"[^>]*value="([^"]+)"/);

          if (relayMatch && samlMatch) {
            const samlResp = await fetch(actionMatch[1]!, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: cookieStr,
              },
              body: `RelayState=${encodeURIComponent(relayMatch[1]!)}&SAMLResponse=${encodeURIComponent(samlMatch[1]!)}`,
              redirect: "manual",
            });

            const location = samlResp.headers.get("location");
            if (location) return { redirectUrl: location };
          }

          return { redirectUrl: actionMatch[1]! };
        }

        throw new Error("NemLog-in exchange did not return a redirect or SAML form");
      },
    };
  },
};

// --- Direct MitID (mitid.dk self-service portal) ---

interface InitializeResponse {
  aux: string;
}

const directMitid: Provider = {
  name: "Direct MitID",

  detect: (url) =>
    url.includes("mitid.dk/administration/oauth") ||
    url.includes("mitid.dk/mitid-administrative-idp"),

  async bootstrap(url, _body, cookies) {
    const cookieStr = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");

    // Call the initialize endpoint
    const initUrl = url.replace(/\/oauth\/authorize.*/, "/mitid-administrative-idp/v1/initialize");
    const baseOrigin = new URL(url).origin;

    const resp = await fetch(`${baseOrigin}/mitid-administrative-idp/v1/initialize`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: cookieStr,
      },
    });

    if (!resp.ok) throw new Error(`Direct MitID initialize failed: ${resp.status}`);
    const data = (await resp.json()) as InitializeResponse;

    const aux = JSON.parse(
      Buffer.from(data.aux, "base64").toString("utf-8"),
    ) as AuxData;

    return {
      clientHash: Buffer.from(aux.coreClient.checksum, "base64").toString("hex"),
      authenticationSessionId: aux.parameters.authenticationSessionId,
      apiBaseUrl: aux.parameters.apiUrl.replace(/\/mitid-core-client-backend\/v1\/$/, ""),
      cookies,
      exchange: async (authCode: string, exchangeCookies: CookieJar) => {
        return {
          redirectUrl: `${baseOrigin}/mitid-administrative-idp/login?AuthCode=${encodeURIComponent(authCode)}`,
        };
      },
    };
  },
};

// --- Provider registry ---

const providers: Provider[] = [criipto, nemlogin, directMitid];

export function detectProvider(url: string, body: string): Provider | null {
  return providers.find((p) => p.detect(url, body)) ?? null;
}

export function getProvider(name: string): Provider | null {
  return providers.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null;
}

export function listProviders(): string[] {
  return providers.map((p) => p.name);
}
