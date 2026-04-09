// Identity lookup API for MitID test/pre-production environment

const CLIENT_CREDENTIALS =
	"NnYzNHY2Y3pjZXhmZGY1dnljbGptdWU4NDVkNndkMDA6MDEwOEQwQTQ1MzlBNjdCOEJBOEM2Mjc5RjJFMTdDMDVDM0UwNDJDQ0Y0NjE1NjBGMUJGRUU4MDk2REM2RUQ1MQ==";

export interface MitIDIdentity {
	identityId: string;
	identityName: string;
	userId: string;
	cprNumber: string;
	identityStatus: string;
	ial: string;
	attributes?: {
		email?: string;
		[key: string]: string | undefined;
	};
}

export interface CodeAppAuthenticator {
	authenticatorId: string;
	state: string;
	lastSuccessTime?: string;
}

interface SearchResult {
	resultsFound: boolean;
	identities: Array<{ identityId: string }>;
}

export interface ResolvedIdentity {
	identity: MitIDIdentity;
	codeApp: CodeAppAuthenticator | null;
}

interface TokenResponse {
	access_token: string;
	expires_in: number;
}

const DEFAULT_BASE_URL = "https://pp.mitid.dk";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getToken(baseUrl: string): Promise<string> {
	if (cachedToken && Date.now() / 1000 < tokenExpiry) return cachedToken;

	const resp = await fetch(
		`${baseUrl}/mitid-administrative-idp/oauth/token?grant_type=client_credentials`,
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${CLIENT_CREDENTIALS}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: "{}",
		},
	);
	const data = (await resp.json()) as TokenResponse;
	if (!data.access_token) throw new Error("Failed to get auth token");
	cachedToken = data.access_token;
	tokenExpiry = Date.now() / 1000 + data.expires_in - 60;
	return cachedToken;
}

async function api(
	baseUrl: string,
	method: string,
	path: string,
	body?: Record<string, string | undefined>,
): Promise<unknown> {
	const token = await getToken(baseUrl);
	const opts: RequestInit = {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
			"Content-Type": "application/json",
		},
	};
	if (body) opts.body = JSON.stringify(body);
	const resp = await fetch(`${baseUrl}${path}`, opts);
	if (!resp.ok)
		throw new Error(`MitID API ${method} ${path} failed: ${resp.status}`);
	return resp.json();
}

export async function searchIdentity(
	query: string,
	baseUrl: string = DEFAULT_BASE_URL,
): Promise<SearchResult> {
	const isUuid =
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
			query,
		);
	const isCpr = /^\d{10}$/.test(query);

	const body = isUuid
		? { identityId: query }
		: isCpr
			? { cprNumber: query }
			: { userId: query };

	return api(
		baseUrl,
		"POST",
		"/administration/v5/identities",
		body,
	) as Promise<SearchResult>;
}

export async function resolve(
	query: string,
	baseUrl: string = DEFAULT_BASE_URL,
): Promise<ResolvedIdentity> {
	const search = await searchIdentity(query, baseUrl);
	if (!search.resultsFound) throw new Error(`No identity found for: ${query}`);

	const uuid = search.identities[0]?.identityId;
	if (!uuid) throw new Error(`No identity ID in search results for: ${query}`);

	const details = (await api(
		baseUrl,
		"GET",
		`/administration/v8/identities/${uuid}`,
	)) as MitIDIdentity[];
	const identity = details[0];
	if (!identity) throw new Error(`No identity details for: ${uuid}`);

	let codeApp: CodeAppAuthenticator | null = null;
	try {
		const apps = (await api(
			baseUrl,
			"GET",
			`/mitid-test-api/v4/identities/${uuid}/authenticators/code-app`,
		)) as CodeAppAuthenticator[];
		codeApp = apps[0] ?? null;
	} catch {
		// No code app authenticator
	}

	return { identity, codeApp };
}

export function simulatorUrl(
	uuid: string,
	authId: string,
	baseUrl: string = DEFAULT_BASE_URL,
): string {
	return `${baseUrl}/test-tool/code-app-simulator/#/${uuid}/details/${authId}`;
}
