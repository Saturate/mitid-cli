import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// We need to override the storage path before importing
// Since storage.ts uses a constant path, we'll test the logic directly
import {
  loadUsers,
  saveUsers,
  findByAlias,
  addOrUpdate,
  removeByAlias,
} from "../src/storage.js";
import type { SavedIdentity } from "../src/index.js";

const testEntry: SavedIdentity = {
  alias: "testuser",
  username: "TestUser123",
  name: "Test User",
  uuid: "00000000-0000-0000-0000-000000000000",
  cpr: "0101900000",
  authId: "A-0000-0000-0000",
  note: null,
  savedAt: "2026-01-01T00:00:00.000Z",
};

describe("storage", () => {
  // These tests modify ~/.mitid/users.json
  // We test the API but restore state after

  let originalUsers: SavedIdentity[];

  beforeEach(() => {
    originalUsers = loadUsers();
  });

  afterEach(() => {
    saveUsers(originalUsers);
  });

  it("addOrUpdate adds a new entry", () => {
    addOrUpdate(testEntry);
    const found = findByAlias("testuser");
    expect(found).toBeTruthy();
    expect(found?.username).toBe("TestUser123");
  });

  it("addOrUpdate updates existing entry by alias", () => {
    addOrUpdate(testEntry);
    addOrUpdate({ ...testEntry, name: "Updated Name" });
    const users = loadUsers();
    const matches = users.filter((u) => u.alias === "testuser");
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("Updated Name");
  });

  it("findByAlias returns null for unknown alias", () => {
    expect(findByAlias("nonexistent-alias-xyz")).toBeFalsy();
  });

  it("removeByAlias removes and returns the entry", () => {
    addOrUpdate(testEntry);
    const removed = removeByAlias("testuser");
    expect(removed.alias).toBe("testuser");
    expect(findByAlias("testuser")).toBeFalsy();
  });

  it("removeByAlias throws for unknown alias", () => {
    expect(() => removeByAlias("nonexistent-alias-xyz")).toThrow();
  });
});
