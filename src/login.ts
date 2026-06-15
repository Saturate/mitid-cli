// MitID login flow orchestration
// Auto-detects the broker/provider and handles the full OAuth → MitID → session flow
import { MitIDClient } from "./client.js";
import type { CookieJar, LoginContext, Provider } from "./providers.js";
import { detectProvider, listProviders } from "./providers.js";

export type LoginStatusCallback = (message: string) => void;

export interface LoginOptions {
	// CPR number, needed by brokers that ask for it after auth (e.g. Criipto
	// when the OIDC scope includes "ssn").
	cpr?: string;
}

export interface LoginResult {
	cookies: CookieJar;
	body: string;
	finalUrl: string;
	provider: string;
}

interface RedirectResult {
	finalUrl: string;
	body: string;
	cookies: CookieJar;
	status: number;
}

export async function followRedirects(
	url: string,
	cookies: CookieJar = {},
): Promise<RedirectResult> {
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

		// Set MITID_DEBUG to trace the redirect chain; invaluable when a broker
		// changes its flow (as Criipto did by adding the CPR-entry screen).
		if (process.env.MITID_DEBUG)
			console.error(
				`[hop] ${resp.status} ${currentUrl}` +
					(resp.headers.get("location")
						? ` -> ${resp.headers.get("location")}`
						: ""),
			);

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
			status: resp.status,
		};
	}

	throw new Error("Too many redirects");
}

export async function login(
	username: string,
	serviceLoginUrl: string,
	onStatus?: LoginStatusCallback,
	providerOverride?: Provider,
	options?: LoginOptions,
): Promise<LoginResult> {
	const log = onStatus ?? console.log;

	// Step 1: Follow OAuth redirects to the broker page
	log("Following OAuth redirects...");
	const { finalUrl, body, cookies } = await followRedirects(serviceLoginUrl);

	// Step 2: Detect or use the specified provider
	const provider = providerOverride ?? detectProvider(finalUrl, body);
	if (!provider) {
		throw new Error(
			`Could not detect MitID provider from ${new URL(finalUrl).hostname}. ` +
				`Supported providers: ${listProviders().join(", ")}. ` +
				`If your service uses a different broker, see: https://github.com/Saturate/mitid-cli#adding-a-provider`,
		);
	}

	log(`Detected provider: ${provider.name}`);

	// Step 3: Bootstrap the MitID session via the provider
	log("Fetching MitID session...");
	const session = await provider.bootstrap(finalUrl, body, cookies);
	log(`Session: ${session.authenticationSessionId}`);

	// Step 4: Authenticate with MitID
	const client = new MitIDClient({ baseUrl: session.apiBaseUrl });
	Object.assign(client.cookies, session.cookies);
	await client.init(session.clientHash, session.authenticationSessionId);

	const authenticators = await client.identifyAndGetAuthenticators(username);
	log(`Available authenticators: ${Object.keys(authenticators).join(", ")}`);

	if (!authenticators.APP) {
		throw new Error("APP authenticator not available for this user");
	}

	await client.authenticateWithApp(log);
	const authCode = await client.finalize();
	log(`Auth code: ${authCode.substring(0, 8)}...`);

	// Step 5: Exchange auth code via the provider's callback
	log("Exchanging auth code...");
	const { redirectUrl } = await session.exchange(authCode, cookies);

	let final = await followRedirects(redirectUrl, cookies);

	// Some brokers interpose extra screens between the auth-code callback and the
	// relying-party callback (e.g. Criipto's CPR entry when the scope includes
	// "ssn"), served as a 200 page that `followRedirects` can't advance on its
	// own. Let the provider drive through them until we reach the final page.
	const context: LoginContext = { cpr: options?.cpr };
	const maxScreens = 5;
	let settled = !session.advance;
	for (let i = 0; session.advance && i < maxScreens; i++) {
		const next = await session.advance(
			{ url: final.finalUrl, body: final.body },
			final.cookies,
			context,
		);
		if (!next) {
			settled = true;
			break;
		}
		log(`Completing broker screen: ${next.screen}`);
		final = await followRedirects(next.redirectUrl, final.cookies);
	}
	if (!settled)
		throw new Error(
			`Broker did not reach a final page after ${maxScreens} screens`,
		);

	log("Login complete!");

	return {
		cookies: final.cookies,
		body: final.body,
		finalUrl: final.finalUrl,
		provider: provider.name,
	};
}
