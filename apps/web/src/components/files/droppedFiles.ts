import { validateWorkspaceEntryName } from "./workspaceEntryName";

/** A file from a Finder drop, with its path below the drop folder. */
export interface DroppedFile {
  readonly relativePath: string;
  readonly file: File;
}

export interface DroppedFiles {
  readonly files: DroppedFile[];
  /** Paths left out: invalid or protected names, unreadable entries, or over the file limit. */
  readonly skipped: string[];
}

/** The subset of the File System Entry API a drop needs, so tests can supply fakes. */
export interface DroppedEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  file?(success: (file: File) => void, failure?: (error: unknown) => void): void;
  createReader?(): {
    readEntries(
      success: (entries: DroppedEntry[]) => void,
      failure?: (error: unknown) => void,
    ): void;
  };
}

interface DropTransfer {
  readonly files: Iterable<File>;
  readonly items?: Iterable<{
    readonly kind: string;
    webkitGetAsEntry(): DroppedEntry | null;
  }>;
}

const MAX_DROPPED_FILES = 2000;

/** Must run during the drop event: the browser empties the transfer once the handler returns. */
export function captureDroppedEntries(transfer: DropTransfer): DroppedEntry[] | File[] {
  if (transfer.items === undefined) return Array.from(transfer.files);
  const entries: DroppedEntry[] = [];
  for (const item of transfer.items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }
  return entries;
}

const readFile = (entry: DroppedEntry) =>
  new Promise<File>((resolve, reject) => {
    if (!entry.file) reject(new Error("Not a file."));
    else entry.file(resolve, reject);
  });

// readEntries returns at most about 100 entries per call, so read until it returns none.
const readDirectory = async (entry: DroppedEntry) => {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const all: DroppedEntry[] = [];
  for (;;) {
    const batch = await new Promise<DroppedEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return all;
    all.push(...batch);
  }
};

export async function collectDroppedFiles(
  captured: DroppedEntry[] | File[],
  limit = MAX_DROPPED_FILES,
): Promise<DroppedFiles> {
  const files: DroppedFile[] = [];
  const skipped: string[] = [];
  const visit = async (entry: DroppedEntry | File, parentPath: string): Promise<void> => {
    const relativePath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    if (!validateWorkspaceEntryName(entry.name).ok) {
      skipped.push(relativePath);
      return;
    }
    if (entry instanceof File) {
      if (files.length < limit) files.push({ relativePath, file: entry });
      else skipped.push(relativePath);
      return;
    }
    if (entry.isDirectory) {
      try {
        for (const child of await readDirectory(entry)) await visit(child, relativePath);
      } catch {
        skipped.push(relativePath);
      }
      return;
    }
    if (files.length >= limit) {
      skipped.push(relativePath);
      return;
    }
    try {
      files.push({ relativePath, file: await readFile(entry) });
    } catch {
      skipped.push(relativePath);
    }
  };
  for (const entry of captured) await visit(entry, "");
  return { files, skipped };
}
