import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CookieJar,
	detectProvider,
	getProvider,
	type ProviderSession,
} from "../src/providers.js";

const ORIGIN = "https://oidc-login-test.example.com";

// Minimal AuxData blob the Criipto bootstrap expects to base64-decode.
const aux = Buffer.from(
	JSON.stringify({
		coreClient: { checksum: Buffer.from("checksum").toString("base64") },
		parameters: {
			authenticationSessionId: "session-123",
			apiUrl: "https://core.example.com/mitid-core-client-backend/v1/",
		},
	}),
).toString("utf-8");

function bootstrapHtml(): string {
	const data = {
		screen: {
			rendition: {
				coreClientScriptSource: `${ORIGIN}/coreclient`,
			},
		},
	};
	const blob = JSON.stringify(data)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;");
	return `<div data-bootstrap="${blob}"></div>`;
}

function cprScreenHtml(): string {
	const data = {
		scenario: "auth",
		screen: {
			screen: "DanishMitID/CprEntry",
			rendition: { formAction: "/DKMitId/CprEntry?cs_v1=abc", error: null },
		},
	};
	const blob = JSON.stringify(data)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;");
	return `<div data-bootstrap="${blob}"></div>`;
}

async function bootstrapCriipto(): Promise<ProviderSession> {
	const provider = getProvider("Criipto");
	if (!provider) throw new Error("Criipto provider missing");

	vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
		new Response(
			JSON.stringify({
				CoreClientAux: Buffer.from(aux).toString("base64"),
				CallbackEndpoint: `${ORIGIN}/callback`,
			}),
			{ status: 200, headers: { "Content-Type": "application/json" } },
		),
	);

	return provider.bootstrap(`${ORIGIN}/page`, bootstrapHtml(), {});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("detectProvider", () => {
	it("detects Criipto from the coreClientScriptSource marker", () => {
		const p = detectProvider(`${ORIGIN}/page`, bootstrapHtml());
		expect(p?.name).toBe("Criipto");
	});
});

describe("Criipto exchange", () => {
	it("appends the auth code to the callback endpoint", async () => {
		const session = await bootstrapCriipto();
		const { redirectUrl } = await session.exchange("the-code", {});
		expect(redirectUrl).toBe(`${ORIGIN}/callback?code=the-code`);
	});
});

describe("Criipto advance", () => {
	it("returns null for a non-broker (relying-party) page", async () => {
		const session = await bootstrapCriipto();
		const result = await session.advance?.(
			{ url: `${ORIGIN}/done`, body: "<html>logged in</html>" },
			{},
			{},
		);
		expect(result).toBeNull();
	});

	it("submits the CPR and follows the redirect off the CprEntry screen", async () => {
		const session = await bootstrapCriipto();
		const cookies: CookieJar = { existing: "1" };

		const postSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(null, {
				status: 302,
				headers: {
					location: "https://rp.example.com/connect/authorize/callback?code=x",
					"set-cookie": "broker-session=abc; Path=/",
				},
			}),
		);

		const result = await session.advance?.(
			{ url: `${ORIGIN}/DKMitId/Exchange?cs_v1=abc`, body: cprScreenHtml() },
			cookies,
			{ cpr: "0401900004" },
		);

		expect(result).toEqual({
			redirectUrl: "https://rp.example.com/connect/authorize/callback?code=x",
			screen: "DanishMitID/CprEntry",
		});

		// Posts the CPR form-encoded to the screen's formAction (resolved absolute).
		const [calledUrl, init] = postSpy.mock.calls.at(-1)!;
		expect(calledUrl).toBe(`${ORIGIN}/DKMitId/CprEntry?cs_v1=abc`);
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe("cpr=0401900004");

		// Folds the broker's Set-Cookie back into the shared jar.
		expect(cookies["broker-session"]).toBe("abc");
	});

	it("throws when the CprEntry screen needs a CPR but none was provided", async () => {
		const session = await bootstrapCriipto();
		await expect(
			session.advance?.(
				{ url: `${ORIGIN}/DKMitId/Exchange?cs_v1=abc`, body: cprScreenHtml() },
				{},
				{},
			),
		).rejects.toThrow(/CPR/);
	});

	it("throws a named error for an unhandled broker screen", async () => {
		const session = await bootstrapCriipto();
		const data = { screen: { screen: "DanishMitID/SomeNewScreen" } };
		const blob = JSON.stringify(data)
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;");
		await expect(
			session.advance?.(
				{
					url: `${ORIGIN}/screen`,
					body: `<div data-bootstrap="${blob}"></div>`,
				},
				{},
				{ cpr: "0401900004" },
			),
		).rejects.toThrow(/DanishMitID\/SomeNewScreen/);
	});

	it("surfaces the screen error when the CPR POST does not redirect", async () => {
		const session = await bootstrapCriipto();
		const errData = {
			screen: {
				screen: "DanishMitID/CprEntry",
				rendition: { error: "Invalid CPR" },
			},
		};
		const errBlob = JSON.stringify(errData)
			.replace(/&/g, "&amp;")
			.replace(/"/g, "&quot;");

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(`<div data-bootstrap="${errBlob}"></div>`, { status: 200 }),
		);

		await expect(
			session.advance?.(
				{ url: `${ORIGIN}/DKMitId/Exchange?cs_v1=abc`, body: cprScreenHtml() },
				{},
				{ cpr: "0401900004" },
			),
		).rejects.toThrow(/Invalid CPR/);
	});
});
