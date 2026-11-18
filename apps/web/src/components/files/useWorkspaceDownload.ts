import type { AssetCreateUrlInput, AssetCreateUrlResult, EnvironmentId } from "@t3tools/contracts";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { msg } from "gt-react";

import { toastManager } from "~/components/ui/toast";
import { m } from "~/i18n/messages";
import { assetEnvironment } from "~/state/assets";
import { readPreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

type CreateAssetUrl = (target: {
  environmentId: EnvironmentId;
  input: AssetCreateUrlInput;
}) => Promise<AtomCommandResult<AssetCreateUrlResult, unknown>>;

async function readWithProgress(
  response: Response,
  onProgress: (loaded: number, total: number) => void,
) {
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body?.getReader();
  if (!reader) return response.blob();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return new Blob(chunks);
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
}

async function fetchWorkspaceFile(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly path: string;
  readonly createUrl: CreateAssetUrl;
  readonly signal: AbortSignal;
  readonly onProgress: (loaded: number, total: number) => void;
}) {
  const issued = await input.createUrl({
    environmentId: input.environmentId,
    input: {
      resource: {
        _tag: "draft-workspace-file",
        cwd: input.cwd,
        path: input.path,
        disposition: "attachment",
      },
    },
  });
  if (issued._tag !== "Success") throw squashAtomCommandFailure(issued);
  const connection = readPreparedConnection(input.environmentId);
  const url = connection ? resolveAssetUrl(connection.httpBaseUrl, issued.value.relativeUrl) : null;
  if (!url) throw new Error(m(msg("Reconnect to the environment and try again.")));
  const response = await fetch(url, { signal: input.signal });
  if (!response.ok) throw new Error(m(msg("The file could not be loaded. Try again.")));
  return readWithProgress(response, input.onProgress);
}

// Kept outside the hook: the React Compiler does not compile try/catch with a throw inside.
async function downloadWorkspaceFile(
  environmentId: EnvironmentId,
  cwd: string,
  path: string,
  createUrl: CreateAssetUrl,
) {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  const controller = new AbortController();
  const toastId = toastManager.add({
    type: "loading",
    title: m(msg("Downloading {name}"), { name }),
    timeout: 0,
    actionProps: { children: m(msg("Cancel")), onClick: () => controller.abort() },
  });
  let shownPercent = -1;
  const onProgress = (loaded: number, total: number) => {
    // One toast update per percent keeps a large file from re-rendering on every chunk.
    const percent = total > 0 ? Math.floor((loaded / total) * 100) : -1;
    if (percent === shownPercent) return;
    shownPercent = percent;
    toastManager.update(toastId, {
      description: m(msg("{loaded} of {total}"), {
        loaded: formatAttachmentSize(loaded),
        total: formatAttachmentSize(total),
      }),
    });
  };
  try {
    const blob = await fetchWorkspaceFile({
      environmentId,
      cwd,
      path,
      createUrl,
      signal: controller.signal,
      onProgress,
    });
    // Blob downloads keep desktop's custom app scheme from navigating to an external browser.
    const blobUrl = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = name;
    anchor.click();
  } catch (error) {
    if (!controller.signal.aborted) {
      toastManager.add({
        type: "error",
        title: m(msg("Could not download {name}"), { name }),
        description: thrownErrorMessage(error, m) ?? m(msg("Please try again.")),
      });
    }
  } finally {
    toastManager.close(toastId);
  }
}

/** Saves one workspace file to the viewer's device, with progress and cancel in a toast. */
export function useWorkspaceDownload(environmentId: EnvironmentId, cwd: string) {
  const createUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  return (path: string) => downloadWorkspaceFile(environmentId, cwd, path, createUrl);
}
