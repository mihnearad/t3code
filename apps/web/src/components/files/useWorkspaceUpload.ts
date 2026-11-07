import {
  type EnvironmentId,
  PROJECT_UPLOAD_MAX_BYTES,
  type ProjectCreateUploadUrlInput,
  type ProjectCreateUploadUrlResult,
} from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { readPreparedConnection } from "~/state/session";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import type { DroppedFile } from "./droppedFiles";
import { joinWorkspacePath, parentWorkspacePath } from "./workspaceEntryName";

export interface WorkspaceUploadProgress {
  readonly fileCount: number;
  readonly filesDone: number;
  readonly bytesTotal: number;
  readonly bytesDone: number;
  readonly currentPath: string | null;
}

const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const UPLOAD_CONCURRENCY = 3;

function postBytes(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
  register: (abort: () => void) => void,
) {
  const xhr = new XMLHttpRequest();
  register(() => xhr.abort());
  return new Promise<void>((resolve, reject) => {
    xhr.open("POST", url, true);
    xhr.timeout = UPLOAD_TIMEOUT_MS;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => onProgress(event.loaded));
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(xhr.responseText.trim() || `Upload rejected (${xhr.status}).`));
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
    xhr.addEventListener("timeout", () => reject(new Error("Upload timed out.")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
    xhr.send(file);
  });
}

const describeError = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Upload failed.";

interface UploadBatch {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly folderPath: string;
  readonly files: readonly DroppedFile[];
  readonly skipped: readonly string[];
  readonly createUploadUrl: (value: {
    environmentId: EnvironmentId;
    input: ProjectCreateUploadUrlInput;
  }) => Promise<AtomCommandResult<ProjectCreateUploadUrlResult, unknown>>;
  readonly setProgress: (progress: WorkspaceUploadProgress | null) => void;
  /** Registers an in-flight request's abort; the returned function unregisters it. */
  readonly addAbort: (abort: () => void) => () => void;
  readonly isCancelled: () => boolean;
  readonly onFoldersChanged: (folders: ReadonlySet<string>) => void;
}

// Kept outside the hook: the React Compiler does not compile the counters this loop updates.
async function runUploadBatch(batch: UploadBatch) {
  const failures = batch.skipped.map((path) => `${path}: skipped`);
  const tooLarge = batch.files.filter((dropped) => dropped.file.size > PROJECT_UPLOAD_MAX_BYTES);
  for (const dropped of tooLarge) {
    failures.push(
      `${dropped.relativePath}: larger than ${formatAttachmentSize(PROJECT_UPLOAD_MAX_BYTES)}`,
    );
  }
  const files = batch.files.filter((dropped) => !tooLarge.includes(dropped));
  const bytesTotal = files.reduce((sum, dropped) => sum + dropped.file.size, 0);
  let bytesDone = 0;
  let filesDone = 0;
  let uploaded = 0;
  let currentPath: string | null = null;
  const inFlightBytes = new Map<DroppedFile, number>();
  const changedFolders = new Set<string>();
  const report = () => {
    let active = 0;
    for (const loaded of inFlightBytes.values()) active += loaded;
    batch.setProgress({
      fileCount: files.length,
      filesDone,
      bytesTotal,
      bytesDone: bytesDone + active,
      currentPath,
    });
  };

  // "exists" when overwrite is off and the file is already there.
  const uploadOne = async (dropped: DroppedFile, overwrite: boolean) => {
    const relativePath = joinWorkspacePath(batch.folderPath, dropped.relativePath);
    currentPath = relativePath;
    inFlightBytes.set(dropped, 0);
    report();
    const issued = await batch.createUploadUrl({
      environmentId: batch.environmentId,
      input: { cwd: batch.cwd, relativePath, sizeBytes: dropped.file.size, overwrite },
    });
    if (issued._tag !== "Success") throw squashAtomCommandFailure(issued);
    if (issued.value.status === "exists") return "exists";
    const connection = readPreparedConnection(batch.environmentId);
    const url = connection
      ? resolveAssetUrl(connection.httpBaseUrl, issued.value.relativeUrl)
      : null;
    if (!url) throw new Error("The environment is not connected.");
    if (batch.isCancelled()) throw new Error("Upload cancelled.");
    let unregister = () => {};
    try {
      await postBytes(
        url,
        dropped.file,
        (loaded) => {
          inFlightBytes.set(dropped, loaded);
          report();
        },
        (abort) => {
          unregister = batch.addAbort(abort);
        },
      );
    } finally {
      unregister();
    }
    changedFolders.add(parentWorkspacePath(relativePath));
    uploaded += 1;
    return "uploaded";
  };

  const uploadAll = async (queue: readonly DroppedFile[], overwrite: boolean) => {
    const existing: DroppedFile[] = [];
    let next = 0;
    const worker = async () => {
      while (!batch.isCancelled() && next < queue.length) {
        const dropped = queue[next++]!;
        try {
          if ((await uploadOne(dropped, overwrite)) === "exists") {
            existing.push(dropped);
            continue;
          }
          bytesDone += dropped.file.size;
        } catch (error) {
          if (batch.isCancelled()) break;
          failures.push(`${dropped.relativePath}: ${describeError(error)}`);
        } finally {
          inFlightBytes.delete(dropped);
        }
        filesDone += 1;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, worker));
    return existing;
  };

  try {
    const existing = await uploadAll(files, false);
    if (existing.length > 0 && !batch.isCancelled()) {
      const listed = existing.slice(0, 8).map((dropped) => dropped.relativePath);
      const more =
        existing.length > listed.length ? `\n…and ${existing.length - listed.length} more` : "";
      const count = existing.length === 1 ? "1 existing file" : `${existing.length} existing files`;
      const replace =
        (await requestConfirmDialog(`Replace ${count}?\n${listed.join("\n")}${more}`, {
          variant: "destructive",
        })) ?? false;
      if (replace) await uploadAll(existing, true);
      else {
        for (const dropped of existing) failures.push(`${dropped.relativePath}: kept existing`);
      }
    }
  } finally {
    batch.setProgress(null);
    if (changedFolders.size > 0) batch.onFoldersChanged(changedFolders);
  }

  const attempted = files.length + tooLarge.length;
  if (batch.isCancelled()) {
    toastManager.add({
      type: "warning",
      title: "Upload cancelled",
      description: `${uploaded} of ${attempted} files uploaded.`,
    });
  } else if (failures.length > 0) {
    toastManager.add({
      type: uploaded > 0 ? "warning" : "error",
      title: `Uploaded ${uploaded} of ${attempted} files`,
      description: failures.slice(0, 6).join("\n") + (failures.length > 6 ? "\n…" : ""),
    });
  } else if (uploaded > 0) {
    toastManager.add({
      type: "success",
      title: uploaded === 1 ? "File uploaded" : `${uploaded} files uploaded`,
      description: batch.folderPath ? `${batch.folderPath}/` : "Project root",
    });
  }
}

/** Uploads dropped files into a workspace folder, a few at a time, and reports progress. */
export function useWorkspaceUpload(environmentId: EnvironmentId, cwd: string) {
  const createUploadUrl = useAtomCommand(projectEnvironment.createUploadUrl, {
    reportFailure: false,
  });
  const [progress, setProgress] = useState<WorkspaceUploadProgress | null>(null);
  const abortsRef = useRef(new Set<() => void>());
  const cancelledRef = useRef(false);

  const cancel = () => {
    cancelledRef.current = true;
    for (const abort of abortsRef.current) abort();
  };

  const start = (input: {
    readonly folderPath: string;
    readonly files: readonly DroppedFile[];
    readonly skipped: readonly string[];
    /** Called with the folders that gained or changed files, after the batch ends. */
    readonly onFoldersChanged: (folders: ReadonlySet<string>) => void;
  }) => {
    if (progress) return Promise.resolve();
    cancelledRef.current = false;
    return runUploadBatch({
      ...input,
      environmentId,
      cwd,
      createUploadUrl,
      setProgress,
      addAbort: (abort) => {
        abortsRef.current.add(abort);
        return () => {
          abortsRef.current.delete(abort);
        };
      },
      isCancelled: () => cancelledRef.current,
    });
  };

  return { progress, start, cancel };
}
