import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { VcsRepositoryDetectionError } from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";

/** Builds a check that a client-supplied cwd stays inside the workspace root or a known workspace. */
export const makeWorkspaceBoundCwdGuard = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const knownWorkspaces = yield* KnownWorkspaces.KnownWorkspaces;

  const canonicalizePath = (operation: string, value: string) => {
    const resolvedPath = path.resolve(value);
    return fileSystem.realPath(resolvedPath).pipe(
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(resolvedPath)
            : Effect.fail(
                new VcsRepositoryDetectionError({
                  operation: `${operation}.canonicalizePath`,
                  cwd: resolvedPath,
                  detail: "Failed to resolve a path while validating the workspace.",
                  cause,
                }),
              ),
      }),
    );
  };

  // `subject` completes "<subject> cwd must stay within the configured workspace root."
  return Effect.fn("WorkspaceBoundCwd.assert")(function* (
    operation: string,
    cwd: string,
    subject: string,
  ) {
    const [candidate, workspaceRoot] = yield* Effect.all([
      canonicalizePath(operation, cwd),
      canonicalizePath(operation, config.cwd),
    ]);
    if (
      KnownWorkspaces.isWithinRoot(path, candidate, workspaceRoot) ||
      (yield* knownWorkspaces.contains(candidate))
    ) {
      return;
    }

    return yield* new VcsRepositoryDetectionError({
      operation,
      cwd,
      detail: `${subject} cwd must stay within the configured workspace root.`,
    });
  });
});
