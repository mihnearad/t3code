import { createGitGraphEnvironmentAtoms } from "@t3tools/client-runtime/state/git-graph";
import type { EnvironmentId, VcsGraphInput } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { revisionedQuery } from "./revisionedQuery";

export const gitGraphEnvironment = createGitGraphEnvironmentAtoms(connectionAtomRuntime);

interface GitGraphPagesTarget {
  readonly environmentId: EnvironmentId;
  readonly input: Omit<VcsGraphInput, "cursor">;
  readonly pageCount: number;
  /** A different revision refetches every page that is read under it. */
  readonly revision: string;
}

const pagesFamily = Atom.family((key: string) => {
  const target = JSON.parse(key) as GitGraphPagesTarget;
  return Atom.make((get) => {
    const queries = [];
    const results = [];
    let cursor: number | undefined;
    for (let page = 0; page < target.pageCount; page++) {
      const query = revisionedQuery(
        gitGraphEnvironment.graph({
          environmentId: target.environmentId,
          input: cursor === undefined ? target.input : { ...target.input, cursor },
        }),
        target.revision,
      );
      const result = get(query);
      queries.push(query);
      results.push(result);
      // The next page's cursor comes from this one, so a page loads only after its predecessor.
      if (result._tag !== "Success" || result.value.nextCursor === null) break;
      cursor = result.value.nextCursor;
    }
    return { queries, results };
  });
});

export const gitGraphPages = (target: GitGraphPagesTarget) => pagesFamily(JSON.stringify(target));
