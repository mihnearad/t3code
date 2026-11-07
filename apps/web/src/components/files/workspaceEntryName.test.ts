import { describe, expect, it } from "@effect/vitest";

import {
  joinWorkspacePath,
  parentWorkspacePath,
  validateWorkspaceEntryName,
} from "./workspaceEntryName";

describe("validateWorkspaceEntryName", () => {
  it.each([
    ["notes.md", "notes.md"],
    ["  spaced.txt  ", "spaced.txt"],
    [".env.example", ".env.example"],
    ["ünïcödé.md", "ünïcödé.md"],
  ])("accepts %j", (input, name) => {
    expect(validateWorkspaceEntryName(input)).toEqual({ ok: true, name });
  });

  it.each([
    ["", "Enter a name."],
    ["   ", "Enter a name."],
    ["a/b.txt", "A name cannot contain / or \\."],
    ["..\\escape", "A name cannot contain / or \\."],
    [".", "This name is reserved."],
    ["..", "This name is reserved."],
    [".git", "Git folders are protected."],
    [".GIT", "Git folders are protected."],
    ["bad\u0000name", "A name cannot contain control characters."],
    ["x".repeat(256), "This name is too long."],
    ["é".repeat(128), "This name is too long."],
  ])("rejects %j", (input, reason) => {
    expect(validateWorkspaceEntryName(input)).toEqual({ ok: false, reason });
  });
});

describe("workspace paths", () => {
  it("joins and splits relative paths at the root and below it", () => {
    expect(joinWorkspacePath("", "a.txt")).toBe("a.txt");
    expect(joinWorkspacePath("src/lib", "a.txt")).toBe("src/lib/a.txt");
    expect(parentWorkspacePath("a.txt")).toBe("");
    expect(parentWorkspacePath("src/lib/a.txt")).toBe("src/lib");
  });
});
