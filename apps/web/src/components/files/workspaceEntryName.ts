export type WorkspaceEntryKind = "file" | "folder";

export type WorkspaceEntryNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: string };

// File systems cap a single name at 255 bytes, not characters.
const MAX_NAME_BYTES = 255;

/** Checks one new file or folder name typed in the file tree. Nested paths are not accepted. */
export function validateWorkspaceEntryName(input: string): WorkspaceEntryNameResult {
  const name = input.trim();
  if (name.length === 0) return { ok: false, reason: "Enter a name." };
  if (name.includes("/") || name.includes("\\")) {
    return { ok: false, reason: "A name cannot contain / or \\." };
  }
  if (name === "." || name === "..") return { ok: false, reason: "This name is reserved." };
  if (name.toLowerCase() === ".git") return { ok: false, reason: "Git folders are protected." };
  if (/[\u0000-\u001f]/.test(name))
    return { ok: false, reason: "A name cannot contain control characters." };
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    return { ok: false, reason: "This name is too long." };
  }
  return { ok: true, name };
}

export function joinWorkspacePath(parentPath: string, name: string): string {
  return parentPath ? `${parentPath}/${name}` : name;
}

/** Where a path ends up after `fromPath` moves to `toPath`, or null when the move leaves it alone. */
export function remapMovedPath(path: string, fromPath: string, toPath: string): string | null {
  if (path === fromPath) return toPath;
  return path.startsWith(`${fromPath}/`) ? `${toPath}${path.slice(fromPath.length)}` : null;
}

export function parentWorkspacePath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}
