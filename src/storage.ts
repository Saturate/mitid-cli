// Saved identities store (~/.mitid/users.json)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".mitid");
const USERS_FILE = join(CONFIG_DIR, "users.json");

export interface SavedIdentity {
  alias: string;
  username: string;
  name: string;
  uuid: string;
  cpr: string;
  authId: string | null;
  note: string | null;
  savedAt: string;
}

export function loadUsers(): SavedIdentity[] {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, "utf-8")) as SavedIdentity[];
}

export function saveUsers(users: SavedIdentity[]): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function findByAlias(alias: string): SavedIdentity | undefined {
  const users = loadUsers();
  return users.find((u) => u.alias === alias);
}

export function addOrUpdate(entry: SavedIdentity): void {
  const users = loadUsers();
  const idx = users.findIndex(
    (u) => u.uuid === entry.uuid || u.alias === entry.alias,
  );
  if (idx >= 0) {
    // Preserve existing note if not explicitly set
    if (entry.note === null && users[idx]!.note) {
      entry.note = users[idx]!.note;
    }
    users[idx] = entry;
  } else {
    users.push(entry);
  }
  saveUsers(users);
}

export function removeByAlias(aliasOrQuery: string): SavedIdentity {
  const users = loadUsers();
  const idx = users.findIndex(
    (u) =>
      u.alias === aliasOrQuery ||
      u.username === aliasOrQuery ||
      u.uuid === aliasOrQuery,
  );
  if (idx < 0) {
    throw new Error(`Not found in saved list: ${aliasOrQuery}`);
  }
  const removed = users[idx]!;
  users.splice(idx, 1);
  saveUsers(users);
  return removed;
}
