import type { EnvironmentId } from "@t3tools/contracts";
import {
  type AtomCommandResult,
  executeAtomQuery,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  joinWorkspacePath,
  parentWorkspacePath,
  type WorkspaceEntryKind,
} from "./workspaceEntryName";

export type WorkspaceEntryActionResult =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly message: string }
  | { readonly ok: false; readonly interrupted: true };

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

const toActionResult = <E>(
  result: AtomCommandResult<{ readonly relativePath: string }, E>,
  fallback: string,
): WorkspaceEntryActionResult => {
  if (result._tag === "Success") return { ok: true, relativePath: result.value.relativePath };
  if (isAtomCommandInterrupted(result)) return { ok: false, interrupted: true };
  return { ok: false, message: errorMessage(squashAtomCommandFailure(result), fallback) };
};

/** Create, rename and move entries in a workspace; each refuses to replace an existing entry. */
export function useWorkspaceEntryActions(environmentId: EnvironmentId, cwd: string) {
  const writeFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const createDirectory = useAtomCommand(projectEnvironment.createDirectory, {
    reportFailure: false,
  });
  const moveEntry = useAtomCommand(projectEnvironment.moveEntry, { reportFailure: false });
  const deleteEntry = useAtomCommand(projectEnvironment.deleteEntry, { reportFailure: false });

  // The server refuses existing names too; this check gives a clearer message first.
  const findExisting = async (relativePath: string) => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      projectEnvironment.listEntries({
        environmentId,
        input: { cwd, directoryPath: parentWorkspacePath(relativePath) },
      }),
      { refresh: true, reportFailure: false, reportDefect: false },
    );
    if (result._tag !== "Success") {
      return { error: errorMessage(Cause.squash(result.cause), "Unable to read the folder.") };
    }
    return { exists: result.value.entries.some((entry) => entry.path === relativePath) };
  };

  const ensureFree = async (relativePath: string): Promise<string | null> => {
    const existing = await findExisting(relativePath);
    if ("error" in existing) return existing.error;
    const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    return existing.exists ? `"${name}" already exists.` : null;
  };

  const create = async (input: {
    readonly kind: WorkspaceEntryKind;
    readonly parentPath: string;
    readonly name: string;
  }): Promise<WorkspaceEntryActionResult> => {
    const relativePath = joinWorkspacePath(input.parentPath, input.name);
    const taken = await ensureFree(relativePath);
    if (taken) return { ok: false, message: taken };
    return input.kind === "folder"
      ? toActionResult(
          await createDirectory({ environmentId, input: { cwd, relativePath } }),
          "Unable to create the folder.",
        )
      : toActionResult(
          await writeFile({
            environmentId,
            input: { cwd, relativePath, contents: "", createOnly: true },
          }),
          "Unable to create the file.",
        );
  };

  const move = async (fromPath: string, toPath: string): Promise<WorkspaceEntryActionResult> => {
    if (fromPath === toPath) return { ok: true, relativePath: toPath };
    const taken = await ensureFree(toPath);
    if (taken) return { ok: false, message: taken };
    return toActionResult(
      await moveEntry({ environmentId, input: { cwd, fromPath, toPath } }),
      "Unable to move the entry.",
    );
  };

  const remove = async (relativePath: string): Promise<WorkspaceEntryActionResult> =>
    toActionResult(
      await deleteEntry({ environmentId, input: { cwd, relativePath } }),
      "Unable to delete the entry.",
    );

  return { create, move, remove };
}
