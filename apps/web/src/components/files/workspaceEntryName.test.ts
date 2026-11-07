import { describe, expect, it } from "@effect/vitest";

import {
  joinWorkspacePath,
  parentWorkspacePath,
  remapMovedPath,
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

  it("follows an open file through a move of itself or of a folder above it", () => {
    expect(remapMovedPath("a.md", "a.md", "docs/a.md")).toBe("docs/a.md");
    expect(remapMovedPath("src/lib/a.ts", "src/lib", "core")).toBe("core/a.ts");
    expect(remapMovedPath("src/library/a.ts", "src/lib", "core")).toBeNull();
    expect(remapMovedPath("b.md", "a.md", "c.md")).toBeNull();
  });
});
