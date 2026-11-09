import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

export const GIT_GRAPH_PAGE_SIZE = 500;

export function createGitGraphEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    graph: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:graph",
      tag: WS_METHODS.vcsGetGraph,
      staleTimeMs: 5_000,
    }),
    repositoryRefs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:refs",
      tag: WS_METHODS.vcsGetRepositoryRefs,
      staleTimeMs: 5_000,
    }),
    commitDetails: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git-graph:commit-details",
      tag: WS_METHODS.vcsGetCommitDetails,
      // A commit never changes, so its details only need to be read once.
      staleTimeMs: 10 * 60_000,
    }),
  };
}
