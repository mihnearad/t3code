import {
  collapseLinearRuns,
  type GitGraphCollapseItem,
} from "@t3tools/client-runtime/git-graph-collapse";
import {
  layoutGitGraph,
  type GitGraphInputCommit,
  type GitGraphLayout,
  type GitGraphRow,
} from "@t3tools/client-runtime/git-graph-layout";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  VcsGraphCommit,
  VcsRepositoryRefsResult,
  VcsRepositoryWorktree,
  VcsStatusResult,
} from "@t3tools/contracts";

const WORKTREE_ROW_PREFIX = "worktree:";
export const GIT_GRAPH_WIDE_MIN_WIDTH = 900;

export type GitGraphRefBadge =
  | { readonly kind: "head" }
  | { readonly kind: "local"; readonly name: string }
  | { readonly kind: "remote"; readonly name: string }
  | { readonly kind: "tag"; readonly name: string }
  | { readonly kind: "worktree"; readonly name: string };

export interface GitGraphDisplayRow {
  /** The commit sha, `worktree:<path>` for an uncommitted-changes row, or the run key of a collapsed row. */
  readonly key: string;
  readonly commit: VcsGraphCommit | null;
  readonly worktree: VcsRepositoryWorktree | null;
  readonly refs: ReadonlyArray<GitGraphRefBadge>;
  readonly layout: GitGraphRow;
  readonly isHead: boolean;
  /** Set on a row that stands for a run of hidden commits. */
  readonly collapsed: { readonly count: number } | null;
}

export interface GitGraphModel {
  readonly rows: ReadonlyArray<GitGraphDisplayRow>;
  readonly layout: GitGraphLayout;
  readonly indexByKey: ReadonlyMap<string, number>;
  /** Lane colour index of each loaded commit, for tinting refs that point at it. */
  readonly colorBySha: ReadonlyMap<string, number>;
  /** Keys of the runs that are collapsed now. */
  readonly collapsedKeys: ReadonlyArray<string>;
}

export function worktreeRowKey(path: string): string {
  return `${WORKTREE_ROW_PREFIX}${path}`;
}

export function pathBasename(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}

function samePath(left: string, right: string): boolean {
  return left.replace(/[\\/]+$/, "") === right.replace(/[\\/]+$/, "");
}

function dedupeCommits(commits: ReadonlyArray<VcsGraphCommit>): VcsGraphCommit[] {
  const seen = new Set<string>();
  return commits.filter((commit) => {
    if (seen.has(commit.sha)) return false;
    seen.add(commit.sha);
    return true;
  });
}

export function listCommitAuthors(commits: ReadonlyArray<VcsGraphCommit>): string[] {
  return [...new Set(commits.map((commit) => commit.authorName))].toSorted((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * The server filters on the message. A hex term of 4 or more characters can also be a sha
 * prefix, which only the client can match on the commits it holds.
 */
export function isShaSearchTerm(search: string): boolean {
  return /^[0-9a-f]{4,}$/i.test(search.trim());
}

function matchesCommitSearch(commit: VcsGraphCommit, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return true;
  if (isShaSearchTerm(term) && commit.sha.toLowerCase().startsWith(term)) return true;
  return commit.subject.toLowerCase().includes(term);
}

export function filterCommits(
  commits: ReadonlyArray<VcsGraphCommit>,
  filters: { readonly author: string | null; readonly search: string },
): VcsGraphCommit[] {
  return commits.filter(
    (commit) =>
      (filters.author === null || commit.authorName === filters.author) &&
      matchesCommitSearch(commit, filters.search),
  );
}

function refBadgesBySha(
  refs: VcsRepositoryRefsResult | null,
): ReadonlyMap<string, GitGraphRefBadge[]> {
  const bySha = new Map<string, GitGraphRefBadge[]>();
  const add = (sha: string | null, badge: GitGraphRefBadge) => {
    if (sha === null) return;
    const list = bySha.get(sha);
    if (list) list.push(badge);
    else bySha.set(sha, [badge]);
  };
  if (refs === null) return bySha;
  add(refs.head.sha, { kind: "head" });
  for (const branch of refs.branches) {
    add(branch.sha, { kind: branch.kind, name: branch.name });
  }
  for (const tag of refs.tags) add(tag.sha, { kind: "tag", name: tag.name });
  for (const worktree of refs.worktrees) {
    add(worktree.sha, { kind: "worktree", name: pathBasename(worktree.path) });
  }
  return bySha;
}

interface BuildGitGraphModelInput {
  readonly commits: ReadonlyArray<VcsGraphCommit>;
  readonly refs: VcsRepositoryRefsResult | null;
  /** More history exists below, so lanes that leave the loaded commits keep running. */
  readonly hasMore: boolean;
  /** A filtered list cannot show uncommitted changes or connected lanes. */
  readonly filtered: boolean;
  /** Hides linear runs of commits that carry no ref and are not selected, except the expanded ones. */
  readonly collapse?: {
    readonly expandedKeys: ReadonlySet<string>;
    readonly selectedKey: string | null;
  } | null;
}

/**
 * Merges refs onto commits and adds one tip row per worktree with uncommitted changes, whose
 * base commit is loaded, before the first commit so the layout draws it as a branch tip.
 */
export function buildGitGraphModel(input: BuildGitGraphModelInput): GitGraphModel {
  const commits = dedupeCommits(input.commits);
  const loaded = new Set(commits.map((commit) => commit.sha));
  const worktrees = input.filtered
    ? []
    : (input.refs?.worktrees ?? []).filter(
        (worktree) =>
          (worktree.changedFiles ?? 0) > 0 && worktree.sha !== null && loaded.has(worktree.sha),
      );
  const badges = refBadgesBySha(input.refs);
  const inputs: GitGraphInputCommit[] = [
    ...worktrees.map((worktree) => ({
      sha: worktreeRowKey(worktree.path),
      parents: [worktree.sha!],
    })),
    ...commits,
  ];
  const { collapse } = input;
  const items: ReadonlyArray<GitGraphCollapseItem<GitGraphInputCommit>> = collapse
    ? collapseLinearRuns(inputs, {
        // Refs and worktree tips carry a badge; the worktree rows are not commits but never hide.
        isPinned: (sha) =>
          badges.has(sha) || sha === collapse.selectedKey || sha.startsWith(WORKTREE_ROW_PREFIX),
        expandedKeys: collapse.expandedKeys,
      })
    : inputs.map((commit) => ({ kind: "commit", commit, graphCommit: commit }));
  const layout = layoutGitGraph(
    items.map((item) => item.graphCommit),
    { missingParents: input.hasMore && !input.filtered ? "extend" : "drop" },
  );
  const itemByGraphSha = new Map(items.map((item) => [item.graphCommit.sha, item]));
  const headSha = input.refs?.head.sha ?? null;
  const worktreeByKey = new Map(
    worktrees.map((worktree) => [worktreeRowKey(worktree.path), worktree]),
  );
  const commitBySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const collapsedKeys: string[] = [];
  const rows = layout.rows.map<GitGraphDisplayRow>((row) => {
    const item = itemByGraphSha.get(row.sha);
    if (item?.kind === "collapsed") {
      collapsedKeys.push(item.key);
      return {
        key: item.key,
        commit: null,
        worktree: null,
        refs: [],
        layout: row,
        isHead: false,
        collapsed: { count: item.hiddenShas.length },
      };
    }
    const worktree = worktreeByKey.get(row.sha) ?? null;
    return {
      key: row.sha,
      commit: worktree ? null : (commitBySha.get(row.sha) ?? null),
      worktree,
      refs: worktree ? [] : (badges.get(row.sha) ?? []),
      layout: row,
      isHead: !worktree && row.sha === headSha,
      collapsed: null,
    };
  });
  const indexByKey = new Map<string, number>();
  const colorBySha = new Map<string, number>();
  rows.forEach((row, index) => {
    indexByKey.set(row.key, index);
    if (row.commit) colorBySha.set(row.key, row.layout.color);
  });
  return { rows, layout, indexByKey, colorBySha, collapsedKeys };
}

/** What in the status can move a ref or the history, so a change refetches the graph. */
export function gitGraphHistoryRevision(status: VcsStatusResult | null): string {
  if (status === null) return "";
  return [
    status.refName ?? "",
    status.hasUpstream ? 1 : 0,
    status.aheadCount,
    status.behindCount,
    JSON.stringify(status.branchChanges ?? null),
  ].join("|");
}

/** The refs also carry uncommitted file counts per worktree, so working-tree changes refetch them. */
export function gitGraphRefsRevision(status: VcsStatusResult | null): string {
  if (status === null) return "";
  return [
    gitGraphHistoryRevision(status),
    status.workingTree.files.length,
    status.workingTree.insertions,
    status.workingTree.deletions,
  ].join("|");
}

export interface WorktreeThreadLink {
  readonly thread: EnvironmentThreadShell;
  readonly others: number;
}

/**
 * The main checkout maps to threads with no worktree of their own. Archived threads are not
 * offered; the most recently updated thread of a worktree is the one linked.
 */
export function findWorktreeThread(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  scope: { readonly environmentId: string; readonly projectId: string },
  worktree: Pick<VcsRepositoryWorktree, "path" | "isMain">,
): WorktreeThreadLink | null {
  const matching = threads
    .filter(
      (thread) =>
        thread.environmentId === scope.environmentId &&
        thread.projectId === scope.projectId &&
        thread.archivedAt === null &&
        (worktree.isMain
          ? thread.worktreePath === null
          : thread.worktreePath !== null && samePath(thread.worktreePath, worktree.path)),
    )
    .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  const [thread] = matching;
  return thread ? { thread, others: matching.length - 1 } : null;
}

export function worktreeBranchLabel(worktree: VcsRepositoryWorktree): string {
  if (worktree.branch !== null) return worktree.branch;
  return worktree.sha === null ? "detached" : `detached at ${worktree.sha.slice(0, 7)}`;
}

/** DD/MM/YYYY HH:mm in the viewer's time zone. */
export function formatCommitDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function refBadgeLabel(badge: GitGraphRefBadge): string {
  return badge.kind === "head" ? "HEAD" : badge.name;
}

export interface CommitTrailer {
  label: string;
  value: string;
}

const TRAILER_LINE = /^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]+(\S.*)$/;
const TRAILER_LABELS: Record<string, string> = {
  "co-authored-by": "Co-author",
  "signed-off-by": "Signed-off",
};

/** Git trailers are the last paragraph of the body when every line is `Key: value`. */
export function splitCommitTrailers(body: string): {
  message: string;
  trailers: CommitTrailer[];
} {
  const paragraphs = body.trim().split(/\n[ \t]*\n/);
  const lines = (paragraphs.at(-1) ?? "").split("\n");
  const matches = lines.map((line) => TRAILER_LINE.exec(line.trim()));
  if (matches.some((match) => match === null)) {
    return { message: body.trim(), trailers: [] };
  }
  return {
    message: paragraphs.slice(0, -1).join("\n\n").trim(),
    trailers: matches.flatMap((match) =>
      match === null
        ? []
        : [
            {
              label: TRAILER_LABELS[match[1]!.toLowerCase()] ?? match[1]!,
              value: match[2]!.trim(),
            },
          ],
    ),
  };
}
