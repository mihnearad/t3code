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
import { msg } from "gt-react";
import { useRef, useState } from "react";

import { toastManager } from "~/components/ui/toast";
import { requestConfirmDialog } from "~/confirmDialog";
import { m } from "~/i18n/messages";
import { readPreparedConnection } from "~/state/session";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import type { DroppedFile } from "./droppedFiles";
import { createUploadProgressStore, type WorkspaceUploadProgress } from "./uploadProgressStore";
import { joinWorkspacePath, parentWorkspacePath } from "./workspaceEntryName";

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
      else
        reject(
          new Error(
            xhr.responseText.trim() ||
              m(msg("Upload rejected ({status})."), { status: xhr.status }),
          ),
        );
    });
    xhr.addEventListener("error", () => reject(new Error(m(msg("Upload failed.")))));
    xhr.addEventListener("timeout", () => reject(new Error(m(msg("Upload timed out.")))));
    xhr.addEventListener("abort", () => reject(new Error(m(msg("Upload cancelled.")))));
    xhr.send(file);
  });
}

const describeError = (error: unknown) =>
  error instanceof Error && error.message ? error.message : m(msg("Upload failed."));

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
  const failures = batch.skipped.map((path) => m(msg("{path}: skipped"), { path }));
  const tooLarge = batch.files.filter((dropped) => dropped.file.size > PROJECT_UPLOAD_MAX_BYTES);
  for (const dropped of tooLarge) {
    failures.push(
      m(msg("{path}: larger than {size}"), {
        path: dropped.relativePath,
        size: formatAttachmentSize(PROJECT_UPLOAD_MAX_BYTES),
      }),
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
    if (!url) throw new Error(m(msg("The environment is not connected.")));
    if (batch.isCancelled()) throw new Error(m(msg("Upload cancelled.")));
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
          failures.push(
            m(msg("{path}: {error}"), { path: dropped.relativePath, error: describeError(error) }),
          );
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
        existing.length > listed.length
          ? m(msg("\n…and {count} more"), { count: existing.length - listed.length })
          : "";
      const count = m(
        msg("{count, plural, one {{count} existing file} other {{count} existing files}}"),
        { count: existing.length },
      );
      const replace =
        (await requestConfirmDialog(
          m(msg("Replace {count}?\n{list}{more}"), { count, list: listed.join("\n"), more }),
          { variant: "destructive" },
        )) ?? false;
      if (replace) await uploadAll(existing, true);
      else {
        for (const dropped of existing)
          failures.push(m(msg("{path}: kept existing"), { path: dropped.relativePath }));
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
      title: m(msg("Upload cancelled")),
      description: m(msg("{uploaded} of {attempted} files uploaded."), { uploaded, attempted }),
    });
  } else if (failures.length > 0) {
    toastManager.add({
      type: uploaded > 0 ? "warning" : "error",
      title: m(msg("Uploaded {uploaded} of {attempted} files"), { uploaded, attempted }),
      description: failures.slice(0, 6).join("\n") + (failures.length > 6 ? "\n…" : ""),
    });
  } else if (uploaded > 0) {
    toastManager.add({
      type: "success",
      title: m(msg("{uploaded, plural, =1 {File uploaded} other {{uploaded} files uploaded}}"), {
        uploaded,
      }),
      description: batch.folderPath ? `${batch.folderPath}/` : m(msg("Project root")),
    });
  }
}

/** Uploads dropped files into a workspace folder, a few at a time, and reports progress. */
export function useWorkspaceUpload(environmentId: EnvironmentId, cwd: string) {
  const createUploadUrl = useAtomCommand(projectEnvironment.createUploadUrl, {
    reportFailure: false,
  });
  const [progressStore] = useState(createUploadProgressStore);
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
    if (progressStore.isActive()) return Promise.resolve();
    cancelledRef.current = false;
    return runUploadBatch({
      ...input,
      environmentId,
      cwd,
      createUploadUrl,
      setProgress: progressStore.set,
      addAbort: (abort) => {
        abortsRef.current.add(abort);
        return () => {
          abortsRef.current.delete(abort);
        };
      },
      isCancelled: () => cancelledRef.current,
    });
  };

  return { progressStore, start, cancel };
}
