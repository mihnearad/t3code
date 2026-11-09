import type { GitGraphInputCommit } from "./gitGraphLayout.ts";

export type GitGraphCollapseItem<T extends GitGraphInputCommit> =
  | { readonly kind: "commit"; readonly commit: T; readonly graphCommit: GitGraphInputCommit }
  | {
      readonly kind: "collapsed";
      // Stable id: the sha of the first hidden commit.
      readonly key: string;
      readonly hiddenShas: ReadonlyArray<string>;
      // sha is `collapsed:<key>`; parents are the parents of the last hidden commit.
      readonly graphCommit: GitGraphInputCommit;
    };

export function collapseLinearRuns<T extends GitGraphInputCommit>(
  commits: ReadonlyArray<T>,
  options: {
    // Commits that must stay visible (refs, HEAD, worktree tips, the selected commit).
    readonly isPinned: (sha: string) => boolean;
    readonly expandedKeys: ReadonlySet<string>;
    // Minimum number of hidden commits to form a collapsed row. Default 3.
    readonly minHidden?: number;
  },
): ReadonlyArray<GitGraphCollapseItem<T>> {
  const minHidden = options.minHidden ?? 3;
  const childCount = new Map<string, number>();
  for (const commit of commits) {
    for (const parent of commit.parents) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }

  // `joinsNext(k)`: commit k and commit k+1 are consecutive links of a linear chain.
  const joinsNext = (index: number) => {
    const commit = commits[index]!;
    const next = commits[index + 1];
    return (
      next !== undefined &&
      commit.parents.length === 1 &&
      commit.parents[0] === next.sha &&
      childCount.get(next.sha) === 1
    );
  };

  const items: Array<GitGraphCollapseItem<T>> = [];
  let start = 0;
  while (start < commits.length) {
    let end = start;
    while (joinsNext(end)) end++;

    let cursor = start;
    while (cursor <= end) {
      const visible = commits[cursor]!;
      // Unpinned inner commits right after `visible`; the run's last commit always stays visible.
      let stop = cursor + 1;
      while (stop < end && !options.isPinned(commits[stop]!.sha)) stop++;
      const hidden = commits.slice(cursor + 1, stop);
      const key = hidden[0]?.sha;
      if (key !== undefined && hidden.length >= minHidden && !options.expandedKeys.has(key)) {
        items.push({
          kind: "commit",
          commit: visible,
          graphCommit: { sha: visible.sha, parents: [`collapsed:${key}`] },
        });
        items.push({
          kind: "collapsed",
          key,
          hiddenShas: hidden.map((commit) => commit.sha),
          graphCommit: { sha: `collapsed:${key}`, parents: hidden[hidden.length - 1]!.parents },
        });
      } else {
        items.push({ kind: "commit", commit: visible, graphCommit: visible });
        for (const commit of hidden) items.push({ kind: "commit", commit, graphCommit: commit });
      }
      cursor = stop;
    }
    start = end + 1;
  }
  return items;
}
