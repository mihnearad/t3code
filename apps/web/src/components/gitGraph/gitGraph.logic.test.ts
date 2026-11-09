import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { VcsGraphCommit, VcsRepositoryRefsResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildGitGraphModel,
  filterCommits,
  findWorktreeThread,
  gitGraphHistoryRevision,
  gitGraphRefsRevision,
  worktreeRowKey,
} from "./gitGraph.logic";

const commit = (
  sha: string,
  parents: string[],
  subject = sha,
  authorName = "Ana",
): VcsGraphCommit => ({
  sha,
  parents,
  subject,
  authorName,
  authoredAt: "2026-11-09T10:00:00.000Z",
});

const refs = (overrides: Partial<VcsRepositoryRefsResult> = {}): VcsRepositoryRefsResult => ({
  isRepo: true,
  head: { sha: "c", branch: "main" },
  branches: [
    { name: "main", kind: "local", sha: "c", upstream: "origin/main", ahead: 0, behind: 0 },
    { name: "origin/main", kind: "remote", sha: "b", upstream: null, ahead: null, behind: null },
  ],
  tags: [{ name: "v1", sha: "a" }],
  worktrees: [],
  ...overrides,
});

const chain = [commit("c", ["b"]), commit("b", ["a"]), commit("a", [])];

describe("buildGitGraphModel", () => {
  it("merges head, branches, tags and worktrees onto the commits they point at", () => {
    const model = buildGitGraphModel({
      commits: chain,
      refs: refs({
        worktrees: [
          {
            path: "/repo/wt",
            branch: null,
            sha: "a",
            isMain: false,
            isCurrent: false,
            changedFiles: 0,
          },
        ],
      }),
      hasMore: false,
      filtered: false,
    });
    expect(model.rows.map((row) => row.refs.map((ref) => ref.kind))).toEqual([
      ["head", "local"],
      ["remote"],
      ["tag", "worktree"],
    ]);
    expect(model.rows[0]?.isHead).toBe(true);
  });

  it("puts a tip row for each worktree with uncommitted changes before the first commit", () => {
    const model = buildGitGraphModel({
      commits: chain,
      refs: refs({
        worktrees: [
          {
            path: "/repo",
            branch: "main",
            sha: "c",
            isMain: true,
            isCurrent: true,
            changedFiles: 2,
          },
          {
            path: "/repo/clean",
            branch: null,
            sha: "b",
            isMain: false,
            isCurrent: false,
            changedFiles: 0,
          },
          {
            path: "/repo/gone",
            branch: null,
            sha: "zzz",
            isMain: false,
            isCurrent: false,
            changedFiles: 3,
          },
        ],
      }),
      hasMore: false,
      filtered: false,
    });
    expect(model.rows.map((row) => row.key)).toEqual([worktreeRowKey("/repo"), "c", "b", "a"]);
    expect(model.rows[0]?.worktree?.changedFiles).toBe(2);
    expect(model.rows[0]?.commit).toBeNull();
    expect(model.rows[1]?.layout.hasChildren).toBe(true);
  });

  it("leaves out uncommitted rows while a filter is active", () => {
    const model = buildGitGraphModel({
      commits: [commit("c", ["b"])],
      refs: refs({
        worktrees: [
          {
            path: "/repo",
            branch: "main",
            sha: "c",
            isMain: true,
            isCurrent: true,
            changedFiles: 2,
          },
        ],
      }),
      hasMore: false,
      filtered: true,
    });
    expect(model.rows.map((row) => row.key)).toEqual(["c"]);
  });

  describe("collapse", () => {
    // n9 (head, branch) -> n8 ... n1 -> n0 (tag): a linear run of ten commits.
    const run = Array.from({ length: 10 }, (_, index) =>
      commit(`n${9 - index}`, index === 9 ? [] : [`n${8 - index}`]),
    );
    const runRefs = refs({
      head: { sha: "n9", branch: "main" },
      branches: [
        { name: "main", kind: "local", sha: "n9", upstream: null, ahead: null, behind: null },
      ],
      tags: [{ name: "v0", sha: "n0" }],
    });
    const build = (selectedKey: string | null, expandedKeys: ReadonlySet<string> = new Set()) =>
      buildGitGraphModel({
        commits: run,
        refs: runRefs,
        hasMore: false,
        filtered: false,
        collapse: { expandedKeys, selectedKey },
      });

    it("folds the unpinned commits between the ref tips into one row", () => {
      const model = build(null);
      const collapsed = model.rows.filter((row) => row.collapsed !== null);
      expect(collapsed).toHaveLength(1);
      expect(collapsed[0]?.collapsed?.count).toBe(8);
      expect(model.collapsedKeys).toEqual(["n8"]);
      expect(model.rows.map((row) => row.commit?.sha ?? null)).toEqual(["n9", null, "n0"]);
    });

    it("keeps the selected commit visible and splits the run around it", () => {
      const model = build("n5");
      expect(model.rows.map((row) => row.commit?.sha ?? `…${row.collapsed?.count}`)).toEqual([
        "n9",
        "…3",
        "n5",
        "…4",
        "n0",
      ]);
    });

    it("shows every commit of an expanded run", () => {
      const model = build(null, new Set(["n8"]));
      expect(model.rows.map((row) => row.commit?.sha)).toEqual(run.map((c) => c.sha));
      expect(model.collapsedKeys).toEqual([]);
    });

    it("never folds worktree tip rows", () => {
      const model = buildGitGraphModel({
        commits: run,
        refs: refs({
          ...runRefs,
          worktrees: [
            {
              path: "/repo",
              branch: "main",
              sha: "n9",
              isMain: true,
              isCurrent: true,
              changedFiles: 1,
            },
          ],
        }),
        hasMore: false,
        filtered: false,
        collapse: { expandedKeys: new Set(), selectedKey: null },
      });
      expect(model.rows[0]?.worktree?.path).toBe("/repo");
    });
  });
});

describe("filterCommits", () => {
  const commits = [
    commit("abcdef1", [], "Fix login", "Ana"),
    commit("1234567", [], "Add abcd docs", "Bo"),
  ];

  it("matches a hex term of 4 characters or more as a sha prefix or in the subject", () => {
    expect(filterCommits(commits, { author: null, search: "abcd" }).map((c) => c.sha)).toEqual([
      "abcdef1",
      "1234567",
    ]);
    expect(filterCommits(commits, { author: null, search: "abc" }).map((c) => c.sha)).toEqual([
      "1234567",
    ]);
  });

  it("filters by author", () => {
    expect(filterCommits(commits, { author: "Bo", search: "" }).map((c) => c.sha)).toEqual([
      "1234567",
    ]);
  });
});

describe("findWorktreeThread", () => {
  const thread = (
    id: string,
    worktreePath: string | null,
    updatedAt: string,
    archivedAt: string | null = null,
  ) =>
    ({
      environmentId: "env-1",
      id,
      projectId: "p1",
      title: id,
      worktreePath,
      updatedAt,
      archivedAt,
    }) as unknown as EnvironmentThreadShell;
  const threads = [
    thread("main-old", null, "2026-11-01"),
    thread("wt-old", "/repo/wt/", "2026-11-01"),
    thread("wt-new", "/repo/wt", "2026-11-05"),
    thread("wt-archived", "/repo/wt", "2026-11-08", "2026-11-09"),
    {
      ...thread("other-project", null, "2026-11-09"),
      projectId: "p2",
    } as unknown as EnvironmentThreadShell,
  ];
  const scope = { environmentId: "env-1", projectId: "p1" };

  it("links the newest unarchived thread of a worktree", () => {
    const link = findWorktreeThread(threads, scope, { path: "/repo/wt", isMain: false });
    expect(link?.thread.id).toBe("wt-new");
    expect(link?.others).toBe(1);
  });

  it("maps the main checkout to threads without a worktree", () => {
    expect(findWorktreeThread(threads, scope, { path: "/repo", isMain: true })?.thread.id).toBe(
      "main-old",
    );
  });
});

describe("git graph status revisions", () => {
  const base = {
    refName: "main",
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    workingTree: { files: [], insertions: 0, deletions: 0 },
  } as never;
  const withChanges = {
    ...(base as object),
    workingTree: {
      files: [{ path: "a", insertions: 1, deletions: 0 }],
      insertions: 1,
      deletions: 0,
    },
  } as never;

  it("moves the history revision with the branch counts and ignores pull request data", () => {
    expect(gitGraphHistoryRevision(base)).toBe(
      gitGraphHistoryRevision({ ...(base as object), pr: null } as never),
    );
    expect(gitGraphHistoryRevision(base)).not.toBe(
      gitGraphHistoryRevision({ ...(base as object), aheadCount: 1 } as never),
    );
  });

  it("moves only the refs revision with working-tree changes", () => {
    expect(gitGraphHistoryRevision(withChanges)).toBe(gitGraphHistoryRevision(base));
    expect(gitGraphRefsRevision(withChanges)).not.toBe(gitGraphRefsRevision(base));
  });
});
