#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { exec } from "child_process";
import { resolve, simulatorUrl } from "./identity.js";
import { approve } from "./simulator.js";
import { login } from "./login.js";
import {
  loadUsers,
  findByAlias,
  addOrUpdate,
  removeByAlias,
} from "./storage.js";
import type { SavedIdentity } from "./index.js";

const DEFAULT_BASE_URL = "https://pp.mitid.dk";

function getBaseUrl(env?: string): string {
  return env === "prod" ? "https://www.mitid.dk" : DEFAULT_BASE_URL;
}

function resolveQuery(query: string): string {
  const match = findByAlias(query);
  return match ? match.username : query;
}

const envArg = {
  type: "string" as const,
  description: "Environment: 'prod' for www.mitid.dk, default is pp.mitid.dk (pre-production)",
  default: "pp",
};

const queryArg = {
  type: "positional" as const,
  description: "Username, UUID, CPR, or saved alias",
  required: true as const,
};

// --- Subcommands ---

const infoCmd = defineCommand({
  meta: { name: "info", description: "Show identity details from the MitID test environment" },
  args: {
    query: queryArg,
    env: envArg,
  },
  async run({ args }) {
    const baseUrl = getBaseUrl(args.env);
    const { identity: i, codeApp } = await resolve(resolveQuery(args.query), baseUrl);

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
  meta: { name: "approve", description: "Poll and auto-approve a pending MitID login via the simulator" },
  args: {
    query: queryArg,
    env: envArg,
  },
  async run({ args }) {
    const baseUrl = getBaseUrl(args.env);
    const { identity, codeApp } = await resolve(resolveQuery(args.query), baseUrl);
    if (!codeApp) throw new Error("No code app authenticator found");

    console.log(`Waiting for MitID transaction...`);
    console.log(`  User: ${identity.userId} (${identity.identityName})`);
    console.log(`  Auth: ${codeApp.authenticatorId}\n`);

    await approve(identity.identityId, codeApp.authenticatorId, baseUrl);
  },
});

const loginCmd = defineCommand({
  meta: { name: "login", description: "Complete a full MitID login and output session cookies" },
  args: {
    query: queryArg,
    url: {
      type: "positional",
      description: "Service login URL (default: DCC dev environment)",
      required: false,
    },
    env: envArg,
  },
  async run({ args }) {
    const serviceUrl = args.url ?? "https://mitdcc.dev.integrationplatform.dccenergi.dev/api/auth/login/mitid?returnUrl=%2F";

    console.log(`Logging in as ${args.query} to ${new URL(serviceUrl).hostname}...`);
    console.log(`Run 'mitid approve ${args.query}' in another terminal to auto-approve.\n`);

    const result = await login(resolveQuery(args.query), serviceUrl, console.log);

    if (result.cookies) {
      console.log("\nSession cookies:");
      for (const [k, v] of Object.entries(result.cookies)) {
        if (v) console.log(`  ${k}=${v.substring(0, 50)}...`);
      }
      const cookieStr = Object.entries(result.cookies)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      exec(`echo -n ${JSON.stringify(cookieStr)} | pbcopy`);
      console.log("\nCookies copied to clipboard");
    }
  },
});

const openCmd = defineCommand({
  meta: { name: "open", description: "Open the code-app simulator in the default browser" },
  args: {
    query: queryArg,
    env: envArg,
  },
  async run({ args }) {
    const baseUrl = getBaseUrl(args.env);
    const { identity, codeApp } = await resolve(resolveQuery(args.query), baseUrl);
    if (!codeApp) throw new Error("No code app authenticator found");

    const url = simulatorUrl(identity.identityId, codeApp.authenticatorId, baseUrl);
    console.log(`Opening simulator for ${identity.identityName}...`);
    exec(`open "${url}"`);
  },
});

const copyCmd = defineCommand({
  meta: { name: "copy", description: "Copy the simulator URL to the clipboard" },
  args: {
    query: queryArg,
    env: envArg,
  },
  async run({ args }) {
    const baseUrl = getBaseUrl(args.env);
    const { identity, codeApp } = await resolve(resolveQuery(args.query), baseUrl);
    if (!codeApp) throw new Error("No code app authenticator found");

    const url = simulatorUrl(identity.identityId, codeApp.authenticatorId, baseUrl);
    exec(`echo -n "${url}" | pbcopy`);
    console.log("Simulator URL copied to clipboard");
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
    const { identity, codeApp } = await resolve(resolveQuery(args.query), baseUrl);
    const url = codeApp ? simulatorUrl(identity.identityId, codeApp.authenticatorId, baseUrl) : null;
    console.log(JSON.stringify({ identity, codeApp, simulatorUrl: url }, null, 2));
  },
});

const saveCmd = defineCommand({
  meta: { name: "save", description: "Save an identity for quick access by alias" },
  args: {
    query: queryArg,
    alias: {
      type: "positional",
      description: "Short alias for this identity (default: username)",
      required: false,
    },
    env: envArg,
  },
  async run({ args }) {
    const baseUrl = getBaseUrl(args.env);
    const { identity, codeApp } = await resolve(resolveQuery(args.query), baseUrl);

    const entry: SavedIdentity = {
      alias: args.alias ?? identity.userId,
      username: identity.userId,
      name: identity.identityName,
      uuid: identity.identityId,
      cpr: identity.cprNumber,
      authId: codeApp?.authenticatorId ?? null,
      savedAt: new Date().toISOString(),
    };

    addOrUpdate(entry);
    console.log(`Saved: ${entry.alias} (${entry.name})`);
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

    const pad = (s: string | null | undefined, n: number) => (s ?? "").padEnd(n);
    console.log("\n  Saved MitID Test Identities");
    console.log("  " + "=".repeat(70));
    console.log(`  ${pad("Alias", 16)} ${pad("Name", 22)} ${pad("Username", 16)} ${pad("Auth ID", 18)}`);
    console.log("  " + "-".repeat(70));

    for (const u of users) {
      console.log(`  ${pad(u.alias, 16)} ${pad(u.name, 22)} ${pad(u.username, 16)} ${pad(u.authId ?? "-", 18)}`);
    }
    console.log();
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

// --- Main ---

const main = defineCommand({
  meta: {
    name: "mitid",
    version: "0.1.0",
    description: "CLI for Denmark's MitID test environment — identity lookup, auto-approve logins, and full browserless authentication",
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
    remove: removeCmd,
  },
});

runMain(main);
