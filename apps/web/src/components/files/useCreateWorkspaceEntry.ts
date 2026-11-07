import type { EnvironmentId } from "@t3tools/contracts";
import {
  executeAtomQuery,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import { joinWorkspacePath, type WorkspaceEntryKind } from "./workspaceEntryName";

export type CreateWorkspaceEntryResult =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly message: string }
  | { readonly ok: false; readonly interrupted: true };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export function useCreateWorkspaceEntry(environmentId: EnvironmentId, cwd: string) {
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const createDirectory = useAtomCommand(projectEnvironment.createDirectory, {
    reportFailure: false,
  });

  // writeFile truncates an existing file, so read the folder fresh before creating.
  const findExisting = async (parentPath: string, relativePath: string) => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      projectEnvironment.listEntries({ environmentId, input: { cwd, directoryPath: parentPath } }),
      { refresh: true, reportFailure: false, reportDefect: false },
    );
    if (result._tag !== "Success") {
      return { error: errorMessage(Cause.squash(result.cause), "Unable to read the folder.") };
    }
    return { exists: result.value.entries.some((entry) => entry.path === relativePath) };
  };

  return async (input: {
    readonly kind: WorkspaceEntryKind;
    readonly parentPath: string;
    readonly name: string;
  }): Promise<CreateWorkspaceEntryResult> => {
    const relativePath = joinWorkspacePath(input.parentPath, input.name);
    const existing = await findExisting(input.parentPath, relativePath);
    if ("error" in existing) return { ok: false, message: existing.error };
    if (existing.exists) return { ok: false, message: `"${input.name}" already exists.` };

    const result =
      input.kind === "folder"
        ? await createDirectory({ environmentId, input: { cwd, relativePath } })
        : await writeFile({ environmentId, input: { cwd, relativePath, contents: "" } });
    if (result._tag === "Success") return { ok: true, relativePath: result.value.relativePath };
    if (isAtomCommandInterrupted(result)) return { ok: false, interrupted: true };
    const fallback =
      input.kind === "folder" ? "Unable to create the folder." : "Unable to create the file.";
    return { ok: false, message: errorMessage(squashAtomCommandFailure(result), fallback) };
  };
}
