import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  VcsUnsupportedOperationError,
  type EnvironmentAuthorizationError,
  type GitCommandError,
  type VcsCommitDetailsInput,
  type VcsCommitDetailsResult,
  type VcsError,
  type VcsGraphInput,
  type VcsGraphResult,
  type VcsRepositoryRefsInput,
  type VcsRepositoryRefsResult,
} from "@t3tools/contracts";

import { makeWorkspaceBoundCwdGuard } from "../workspace/workspaceBoundCwd.ts";
import * as GitVcsDriver from "./GitVcsDriver.ts";
import * as VcsDriverRegistry from "./VcsDriverRegistry.ts";

type VcsGraphError = Exclude<VcsError | GitCommandError, EnvironmentAuthorizationError>;

export class VcsGraphService extends Context.Service<
  VcsGraphService,
  {
    readonly getGraph: (input: VcsGraphInput) => Effect.Effect<VcsGraphResult, VcsGraphError>;
    readonly getRepositoryRefs: (
      input: VcsRepositoryRefsInput,
    ) => Effect.Effect<VcsRepositoryRefsResult, VcsGraphError>;
    readonly getCommitDetails: (
      input: VcsCommitDetailsInput,
    ) => Effect.Effect<VcsCommitDetailsResult, VcsGraphError>;
  }
>()("t3/vcs/VcsGraphService") {}

/** @public */
export const make = Effect.gen(function* () {
  const assertWorkspaceBound = yield* makeWorkspaceBoundCwdGuard;
  const vcsRegistry = yield* VcsDriverRegistry.VcsDriverRegistry;
  const git = yield* GitVcsDriver.GitVcsDriver;

  // Resolves to false when there is no repository, so the caller returns its empty result.
  const requireGit = Effect.fn("VcsGraphService.requireGit")(function* (
    operation: string,
    cwd: string,
  ) {
    yield* assertWorkspaceBound(operation, cwd, "Git graph");
    const handle = yield* vcsRegistry.detect({ cwd, requestedKind: "auto" });
    if (!handle) return false;
    if (handle.kind !== "git") {
      return yield* new VcsUnsupportedOperationError({
        operation,
        kind: handle.kind,
        detail: "The Git graph requires a Git repository.",
      });
    }
    return true;
  });

  const getGraph: VcsGraphService["Service"]["getGraph"] = Effect.fn("VcsGraphService.getGraph")(
    function* (input) {
      if (!(yield* requireGit("VcsGraphService.getGraph", input.cwd))) {
        return { isRepo: false, commits: [], nextCursor: null };
      }
      return yield* git.getGraph(input);
    },
  );

  const getRepositoryRefs: VcsGraphService["Service"]["getRepositoryRefs"] = Effect.fn(
    "VcsGraphService.getRepositoryRefs",
  )(function* (input) {
    if (!(yield* requireGit("VcsGraphService.getRepositoryRefs", input.cwd))) {
      return {
        isRepo: false,
        head: { sha: null, branch: null },
        branches: [],
        tags: [],
        worktrees: [],
      };
    }
    return yield* git.getRepositoryRefs(input);
  });

  const getCommitDetails: VcsGraphService["Service"]["getCommitDetails"] = Effect.fn(
    "VcsGraphService.getCommitDetails",
  )(function* (input) {
    yield* requireGit("VcsGraphService.getCommitDetails", input.cwd);
    return yield* git.getCommitDetails(input);
  });

  return VcsGraphService.of({ getGraph, getRepositoryRefs, getCommitDetails });
});

export const layer = Layer.effect(VcsGraphService, make);
