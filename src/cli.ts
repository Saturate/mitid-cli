#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "citty";
import { registerCodeApp, resolve, simulatorUrl } from "./identity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };

import type { CodeAppAuthenticator, MitIDIdentity, SavedIdentity } from "./index.js";
import { login } from "./login.js";
import { approve, watch } from "./simulator.js";
import {
	addOrUpdate,
	exportUsers,
	findByAlias,
	importUsers,
	loadUsers,
	removeByAlias,
} from "./storage.js";

const DEFAULT_BASE_URL = "https://pp.mitid.dk";

function copyToClipboard(text: string): boolean {
	try {
		spawnSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

function openUrl(url: string): void {
	try {
		execFileSync("open", [url], { stdio: "ignore" });
	} catch {
		console.log(`Could not open browser. URL: ${url}`);
	}
}

function getBaseUrl(env?: string): string {
	return env === "prod" ? "https://www.mitid.dk" : DEFAULT_BASE_URL;
}

function resolveQuery(query: string): string {
	const match = findByAlias(query);
	return match ? match.username : query;
}

const envArg = {
	type: "string" as const,
	description:
		"Environment: 'prod' for www.mitid.dk, default is pp.mitid.dk (pre-production)",
	default: "pp",
};

const queryArg = {
	type: "positional" as const,
	description: "Username, UUID, CPR, or saved alias",
	required: true as const,
};

const noRegisterArg = {
	type: "boolean" as const,
	description: "Don't auto-register a code app if none exists",
	default: false,
};

async function ensureCodeApp(
	query: string,
	baseUrl: string,
	noRegister: boolean,
): Promise<{ identity: MitIDIdentity; codeApp: CodeAppAuthenticator }> {
	const result = await resolve(resolveQuery(query), baseUrl);
	if (result.codeApp) return { identity: result.identity, codeApp: result.codeApp };

	if (noRegister) {
		throw new Error("No code app authenticator found (auto-register disabled)");
	}

	console.log("  No code app found, registering one...");
	const codeApp = await registerCodeApp(result.identity.identityId, result.identity.ial, baseUrl);
	console.log(`  Registered code app: ${codeApp.authenticatorId}\n`);
	return { identity: result.identity, codeApp };
}

// --- Subcommands ---

const infoCmd = defineCommand({
	meta: {
		name: "info",
		description: "Show identity details from the MitID test environment",
	},
	args: {
		query: queryArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const { identity: i, codeApp } = await resolve(
			resolveQuery(args.query),
			baseUrl,
		);

		console.log(`
  MitID Test Identity
  ===================
  Name:       ${i.identityName}
  Username:   ${i.userId}
  UUID:       ${i.identityId}
  CPR:        ${i.cprNumber}
  Status:     ${i.identityStatus}
  IAL:        ${i.ial}
  Email:      ${i.attributes?.email ?? "N/A"}`);

		if (codeApp) {
			console.log(`
  Code App
  --------
  Auth ID:    ${codeApp.authenticatorId}
  State:      ${codeApp.state}
  Last auth:  ${codeApp.lastSuccessTime ?? "never"}

  Simulator:  ${simulatorUrl(i.identityId, codeApp.authenticatorId, baseUrl)}`);
		} else {
			console.log("\n  No code app authenticator registered.");
		}
		console.log();
	},
});

const approveCmd = defineCommand({
	meta: {
		name: "approve",
		description:
			"Poll and auto-approve a pending MitID login via the simulator",
	},
	args: {
		query: queryArg,
		watch: {
			type: "boolean",
			description: "Keep running and approve every incoming transaction",
			alias: ["w"],
			default: false,
		},
		"no-register": noRegisterArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const { identity, codeApp } = await ensureCodeApp(
			args.query,
			baseUrl,
			args["no-register"],
		);

		console.log(`  User: ${identity.userId} (${identity.identityName})`);
		console.log(`  Auth: ${codeApp.authenticatorId}\n`);

		if (args.watch) {
			await watch(identity.identityId, codeApp.authenticatorId, baseUrl);
		} else {
			await approve(identity.identityId, codeApp.authenticatorId, baseUrl);
		}
	},
});

const loginCmd = defineCommand({
	meta: {
		name: "login",
		description: "Complete a full MitID login and output session cookies",
	},
	args: {
		query: queryArg,
		url: {
			type: "positional",
			description:
				"Service login URL that triggers a MitID authentication flow",
			required: true,
		},
		env: envArg,
	},
	async run({ args }) {
		const serviceUrl = args.url;

		console.log(
			`Logging in as ${args.query} to ${new URL(serviceUrl).hostname}...`,
		);
		console.log(
			`Run 'mitid approve ${args.query}' in another terminal to auto-approve.\n`,
		);

		const result = await login(
			resolveQuery(args.query),
			serviceUrl,
			console.log,
		);

		if (result.cookies) {
			console.log("\nSession cookies:");
			for (const [k, v] of Object.entries(result.cookies)) {
				if (v) console.log(`  ${k}=${v.substring(0, 50)}...`);
			}
			const cookieStr = Object.entries(result.cookies)
				.filter(([, v]) => v)
				.map(([k, v]) => `${k}=${v}`)
				.join("; ");
			if (copyToClipboard(cookieStr)) {
				console.log("\nCookies copied to clipboard");
			}
		}
	},
});

const openCmd = defineCommand({
	meta: {
		name: "open",
		description: "Open the code-app simulator in the default browser",
	},
	args: {
		query: queryArg,
		"no-register": noRegisterArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const { identity, codeApp } = await ensureCodeApp(
			args.query,
			baseUrl,
			args["no-register"],
		);

		const url = simulatorUrl(
			identity.identityId,
			codeApp.authenticatorId,
			baseUrl,
		);
		console.log(`Opening simulator for ${identity.identityName}...`);
		openUrl(url);
	},
});

const copyCmd = defineCommand({
	meta: {
		name: "copy",
		description: "Copy the simulator URL to the clipboard",
	},
	args: {
		query: queryArg,
		"no-register": noRegisterArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const { identity, codeApp } = await ensureCodeApp(
			args.query,
			baseUrl,
			args["no-register"],
		);

		const url = simulatorUrl(
			identity.identityId,
			codeApp.authenticatorId,
			baseUrl,
		);
		if (copyToClipboard(url)) {
			console.log("Simulator URL copied to clipboard");
		} else {
			console.log(url);
		}
	},
});

const jsonCmd = defineCommand({
	meta: { name: "json", description: "Output full identity data as JSON" },
	args: {
		query: queryArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const { identity, codeApp } = await resolve(
			resolveQuery(args.query),
			baseUrl,
		);
		const url = codeApp
			? simulatorUrl(identity.identityId, codeApp.authenticatorId, baseUrl)
			: null;
		console.log(
			JSON.stringify({ identity, codeApp, simulatorUrl: url }, null, 2),
		);
	},
});

const saveCmd = defineCommand({
	meta: {
		name: "save",
		description: "Save an identity for quick access by alias",
	},
	args: {
		query: queryArg,
		alias: {
			type: "positional",
			description: "Short alias for this identity (default: username)",
			required: false,
		},
		note: {
			type: "string",
			description:
				"A note to attach to this identity (e.g. 'has 3 addresses', 'expired CPR')",
		},
		"no-register": noRegisterArg,
		env: envArg,
	},
	async run({ args }) {
		const baseUrl = getBaseUrl(args.env);
		const result = await resolve(resolveQuery(args.query), baseUrl);
		if (!result.codeApp && !args["no-register"]) {
			console.log("  No code app found, registering one...");
			result.codeApp = await registerCodeApp(
				result.identity.identityId,
				result.identity.ial,
				baseUrl,
			);
			console.log(
				`  Registered code app: ${result.codeApp.authenticatorId}\n`,
			);
		}
		const { identity, codeApp } = result;

		const entry: SavedIdentity = {
			alias: args.alias ?? identity.userId,
			username: identity.userId,
			name: identity.identityName,
			uuid: identity.identityId,
			cpr: identity.cprNumber,
			authId: codeApp?.authenticatorId ?? null,
			note: args.note ?? null,
			savedAt: new Date().toISOString(),
		};

		addOrUpdate(entry);
		console.log(
			`Saved: ${entry.alias} (${entry.name})${entry.note ? ` - ${entry.note}` : ""}`,
		);
	},
});

const listCmd = defineCommand({
	meta: { name: "list", description: "Show all saved MitID test identities" },
	args: {},
	run() {
		const users = loadUsers();
		if (!users.length) {
			console.log("No saved identities. Use: mitid save <query> [alias]");
			return;
		}

		const pad = (s: string | null | undefined, n: number) =>
			(s ?? "").padEnd(n);
		console.log("\n  Saved MitID Test Identities");
		console.log(`  ${"=".repeat(80)}`);
		console.log(
			`  ${pad("Alias", 14)} ${pad("Name", 20)} ${pad("Username", 14)} ${pad("Note", 30)}`,
		);
		console.log(`  ${"-".repeat(80)}`);

		for (const u of users) {
			console.log(
				`  ${pad(u.alias, 14)} ${pad(u.name, 20)} ${pad(u.username, 14)} ${pad(u.note ?? "", 30)}`,
			);
		}
		console.log();
	},
});

const exportCmd = defineCommand({
	meta: {
		name: "export",
		description: "Export saved identities as JSON (pipe-friendly)",
	},
	args: {},
	run() {
		console.log(exportUsers());
	},
});

const importCmd = defineCommand({
	meta: {
		name: "import",
		description: "Import saved identities from a JSON file",
	},
	args: {
		file: {
			type: "positional",
			description: "Path to JSON file (or - for stdin)",
			required: true,
		},
	},
	run({ args }) {
		let json: string;
		if (args.file === "-") {
			json = readFileSync(0, "utf-8"); // stdin
		} else {
			json = readFileSync(args.file, "utf-8");
		}
		const count = importUsers(json);
		console.log(`Imported ${count} identit${count === 1 ? "y" : "ies"}`);
	},
});

const removeCmd = defineCommand({
	meta: { name: "remove", description: "Remove a saved identity by alias" },
	args: {
		alias: {
			type: "positional",
			description: "Alias or username to remove",
			required: true,
		},
	},
	run({ args }) {
		const removed = removeByAlias(args.alias);
		console.log(`Removed: ${removed.alias} (${removed.name})`);
	},
});

const guideCmd = defineCommand({
	meta: {
		name: "guide",
		description: "Show usage guide for humans and AI agents",
	},
	args: {},
	run() {
		console.log(`
mitid — MitID Test Login Tool
==============================

This tool authenticates with Denmark's MitID pre-production test environment
(pp.mitid.dk) without a browser. It implements the MitID authentication protocol
directly (custom SRP-6a + APP authenticator flow) and auto-approves logins via
the MitID test simulator.

SETUP
-----
  # Save a test identity for quick access
  mitid save <username> <alias>
  mitid list

WORKFLOW 1: Manual browser testing
-----------------------------------
  You login in your browser, the CLI auto-approves the MitID step.

  1. Run in a terminal:     mitid approve <alias> --watch
  2. In your browser:       Click "Log ind med MitID" on your service
  3. Enter the username:    The one from 'mitid info <alias>'
  4. The CLI auto-approves  The browser completes the login
  5. Repeat as needed       --watch keeps approving every login

WORKFLOW 2: Fully automated login (get session cookies)
-------------------------------------------------------
  No browser needed. Gets session cookies you can use with curl, Playwright, etc.

  # Terminal 1: start the login
  mitid login <alias> https://your-service.example.com/login/mitid

  # Terminal 2: auto-approve when it says "Waiting for MitID app approval"
  mitid approve <alias>

  The login command outputs session cookies and copies them to clipboard.

WORKFLOW 3: AI agent with browser automation (Chrome MCP, Playwright, etc.)
---------------------------------------------------------------------------
  For AI agents that control a browser but can't interact with MitID's widget
  (it blocks automated browsers). The agent should:

  1. Run 'mitid login <user> <service-login-url>' in background
  2. Run 'mitid approve <user>' in parallel to auto-approve
  3. Capture the session cookies from the login output
  4. In the browser: navigate to the service URL
  5. Inject cookies via JavaScript:
       document.cookie = "CookieName=value; path=/";
  6. Reload the page — the browser is now logged in
  7. Proceed with testing

  Example cookie injection (browser console / evaluate_script):
    const cookies = { "SessionCookie": "<value>", "Token": "<value>" };
    for (const [name, value] of Object.entries(cookies)) {
      document.cookie = name + "=" + value + "; path=/";
    }
    location.reload();

LIBRARY USAGE
-------------
  import { MitIDClient, login, approve, resolve } from 'mitid';

  // Look up a test identity
  const { identity, codeApp } = await resolve('Username123');

  // Full login flow
  const result = await login('Username123', 'https://service.example.com/login');
  console.log(result.cookies);

  // Or use the client directly
  const client = new MitIDClient('https://pp.mitid.dk');
  await client.init(clientHash, sessionId);
  await client.identifyAndGetAuthenticators('Username123');
  await client.authenticateWithApp();
  const authCode = await client.finalize();

HOW IT WORKS
------------
  The tool replaces two things that normally require human interaction:

  1. The MitID browser widget (JavaScript iframe)
     → Replaced by a direct HTTP implementation of the MitID protocol
       (SRP-6a authentication with MitID's custom parameters)

  2. The MitID app approval (phone notification)
     → Replaced by the simulator API (pp.mitid.dk test tool)
       which auto-approves with PIN 112233

  Protocol flow:
    Service → OAuth redirect → Criipto/NemLog-in broker → MitID session
    → Identify user → APP auth (push to simulator) → Poll for approval
    → SRP key exchange → Finalize → Authorization code → Service callback
    → Session cookies

`);
	},
});

const providersCmd = defineCommand({
	meta: {
		name: "providers",
		description: "List supported MitID broker providers",
	},
	args: {},
	run() {
		console.log("\n  Supported MitID Providers");
		console.log(`  ${"=".repeat(60)}`);
		console.log(`
  Criipto         Auto-detected via *.idura.broker or criipto.* URLs.
                  Used by services integrated through Criipto Verify.

  NemLog-in       Auto-detected via nemlog-in.mitid.dk.
                  Used by Danish public services (borger.dk, skat.dk,
                  e-boks, mit.dk, etc.)

  Direct MitID    Auto-detected via mitid.dk/administration URLs.
                  Used by mitid.dk self-service portal.

  The provider is auto-detected from the OAuth redirect chain.
  If your service uses a different broker, you can add a custom
  provider: https://github.com/Saturate/mitid-cli#adding-a-provider
`);
	},
});

// --- Main ---

const main = defineCommand({
	meta: {
		name: "mitid",
		version: pkg.version,
		description:
			"CLI for Denmark's MitID test environment — identity lookup, auto-approve logins, and full browserless authentication",
	},
	subCommands: {
		info: infoCmd,
		approve: approveCmd,
		login: loginCmd,
		open: openCmd,
		copy: copyCmd,
		json: jsonCmd,
		save: saveCmd,
		list: listCmd,
		export: exportCmd,
		import: importCmd,
		remove: removeCmd,
		providers: providersCmd,
		guide: guideCmd,
	},
});

runMain(main);
