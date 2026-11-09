import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { GIT_GRAPH_PAGE_SIZE } from "@t3tools/client-runtime/state/git-graph";
import type { ScopedThreadRef, VcsRepositoryWorktree } from "@t3tools/contracts";
import { useDebouncedValue } from "@tanstack/react-pacer";
import { GitGraph } from "lucide-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useContext, useLayoutEffect, useRef, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { revisionedQuery } from "~/state/revisionedQuery";
import { useProject, useQuietThreadShell, useQuietThreadShells } from "~/state/entities";
import { gitGraphEnvironment, gitGraphPages } from "~/state/gitGraph";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { GitGraphDetails } from "./GitGraphDetails";
import { GitGraphList } from "./GitGraphList";
import { GitGraphRefsColumn } from "./GitGraphRefsColumn";
import { ALL_BRANCHES, CURRENT_BRANCH, GitGraphToolbar } from "./GitGraphToolbar";
import {
  buildGitGraphModel,
  filterCommits,
  findWorktreeThread,
  GIT_GRAPH_WIDE_MIN_WIDTH,
  gitGraphHistoryRevision,
  gitGraphRefsRevision,
  isShaSearchTerm,
  listCommitAuthors,
  worktreeRowKey,
} from "./gitGraph.logic";

const PAGE_SIZE = GIT_GRAPH_PAGE_SIZE;
const ALL_REMOTE_BRANCHES_KEY = "t3code.gitGraph.allRemoteBranches";
const COLLAPSE_LINEAR_KEY = "t3code.gitGraph.collapseLinear";
const NO_KEYS: ReadonlySet<string> = new Set();

function useSurfaceWide() {
  const ref = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- observes the surface width to choose between the wide and narrow layouts
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = (width: number) => setWide(width >= GIT_GRAPH_WIDE_MIN_WIDTH);
    update(element.getBoundingClientRect().width);
    return observeResize(element, (entries) => {
      const entry = entries[entries.length - 1];
      if (entry) update(entry.contentRect.width);
    });
  }, []);
  return { ref, wide };
}

function GraphSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-2 p-3" aria-busy>
      {Array.from({ length: 12 }, (_, index) => (
        <Skeleton key={index} className="h-5 w-full" />
      ))}
    </div>
  );
}

function GraphEmpty(props: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <Empty size="compact">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <GitGraph />
        </EmptyMedia>
        <EmptyTitle>{props.title}</EmptyTitle>
        <EmptyDescription>{props.description}</EmptyDescription>
      </EmptyHeader>
      {props.action ? <EmptyContent>{props.action}</EmptyContent> : null}
    </Empty>
  );
}

function GitGraphSurface(props: {
  threadRef: ScopedThreadRef;
  projectId: string;
  cwd: string;
  workspaceMutationId: string | null;
}) {
  const { threadRef, cwd } = props;
  const environmentId = threadRef.environmentId;
  const registry = useContext(RegistryContext);
  const { ref: rootRef, wide } = useSurfaceWide();
  const listRef = useRef<LegendListRef>(null);

  const [branchValue, setBranchValue] = useState(ALL_BRANCHES);
  const [author, setAuthor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [firstParent, setFirstParent] = useState(false);
  const [allRemoteBranches, setAllRemoteBranches] = useLocalStorage(
    ALL_REMOTE_BRANCHES_KEY,
    false,
    Schema.Boolean,
  );
  const [collapseLinear, setCollapseLinear] = useLocalStorage(
    COLLAPSE_LINEAR_KEY,
    false,
    Schema.Boolean,
  );
  const [expanded, setExpanded] = useState({ resetKey: "", keys: NO_KEYS });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pageState, setPageState] = useState({ resetKey: "", count: 1 });
  const [debouncedSearch] = useDebouncedValue(search, { wait: 300 });

  // The status stream is the signal that a commit, fetch or branch switch happened.
  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  // The graph refetches only when refs or history can move; the refs also show uncommitted counts.
  const mutationId = props.workspaceMutationId ?? "";
  const historyRevision = `${mutationId}#${gitGraphHistoryRevision(status.data)}`;
  const refsRevision = `${mutationId}#${gitGraphRefsRevision(status.data)}`;

  const refsQuery = useEnvironmentQuery(
    revisionedQuery(
      gitGraphEnvironment.repositoryRefs({
        environmentId,
        input: { cwd, remoteBranches: allRemoteBranches ? "all" : "upstreams" },
      }),
      refsRevision,
    ),
  );
  const refs = refsQuery.data;

  const term = debouncedSearch.trim();
  const shaTerm = isShaSearchTerm(term);
  const ref =
    branchValue === ALL_BRANCHES
      ? undefined
      : branchValue === CURRENT_BRANCH
        ? (refs?.head.branch ?? "HEAD")
        : branchValue;
  const input = {
    cwd,
    limit: PAGE_SIZE,
    ...(ref === undefined ? {} : { ref }),
    ...(firstParent ? { firstParent: true } : {}),
    remoteBranches: allRemoteBranches ? ("all" as const) : ("upstreams" as const),
    // A hex term may be a sha prefix, which only the loaded commits can answer.
    ...(term.length > 0 && !shaTerm ? { query: term } : {}),
  };
  // The revision is not part of the key: loaded pages refetch in place and keep their count.
  const resetKey = JSON.stringify(input);
  const pageCount = pageState.resetKey === resetKey ? pageState.count : 1;

  const pages = useAtomValue(
    gitGraphPages({ environmentId, input, pageCount, revision: historyRevision }),
  );
  const pageValues = pages.results.map((result) => AsyncResult.getOrElse(result, () => null));
  const firstResult = pages.results[0];
  const lastIndex = pages.results.length - 1;
  const lastResult = pages.results[lastIndex];
  const lastValue = pageValues[lastIndex] ?? null;
  const firstError =
    firstResult?._tag === "Failure" && Option.isNone(AsyncResult.value(firstResult))
      ? formatEnvironmentQueryError(firstResult.cause)
      : null;
  const loadMoreError =
    lastIndex > 0 && lastResult?._tag === "Failure" && Option.isNone(AsyncResult.value(lastResult))
      ? formatEnvironmentQueryError(lastResult.cause)
      : null;
  // Only a page with no value yet; a refetch of a loaded page keeps its rows on screen.
  const loadingMore = lastIndex > 0 && lastResult?._tag === "Initial";
  const hasMore =
    lastResult?._tag === "Success" && lastValue !== null && lastValue.nextCursor !== null;

  const allCommits = pageValues.flatMap((value) => value?.commits ?? []);
  const authors = listCommitAuthors(allCommits);
  const clientSearch = shaTerm ? term : "";
  // Expanded runs are forgotten when the toggle or a filter changes, not when the data refreshes.
  const expandResetKey = JSON.stringify([collapseLinear, input, author, clientSearch]);
  const expandedKeys = expanded.resetKey === expandResetKey ? expanded.keys : NO_KEYS;
  const modelSelectedKey = collapseLinear ? selectedKey : null;
  const model = buildGitGraphModel({
    commits: filterCommits(allCommits, { author, search: clientSearch }),
    refs,
    hasMore,
    filtered: author !== null || clientSearch !== "" || firstParent,
    collapse: collapseLinear ? { expandedKeys, selectedKey: modelSelectedKey } : null,
  });
  const expand = useStableCallback((keys: ReadonlyArray<string>) =>
    setExpanded({ resetKey: expandResetKey, keys: new Set([...expandedKeys, ...keys]) }),
  );
  const onExpand = useStableCallback((key: string) => expand([key]));

  const shells = useQuietThreadShells();
  const projectId = props.projectId;
  const worktreeLinks = new Map(
    (refs?.worktrees ?? []).map((worktree) => [
      worktree.path,
      findWorktreeThread(shells, { environmentId, projectId }, worktree),
    ]),
  );
  const localBranches = (refs?.branches ?? []).filter((b) => b.kind === "local").map((b) => b.name);
  const worktreePaths = (refs?.worktrees ?? []).map((worktree) => worktree.path);

  const selectedRow =
    (selectedKey === null ? undefined : model.rows[model.indexByKey.get(selectedKey) ?? -1]) ??
    (wide ? (model.rows.find((row) => row.isHead) ?? model.rows[0]) : undefined);

  const jumpToKey = (key: string): boolean => {
    const index = model.indexByKey.get(key);
    if (index === undefined) return false;
    setSelectedKey(key);
    void listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.35 });
    return true;
  };
  const jumpToSha = useStableCallback((sha: string | null) => {
    if (sha !== null && jumpToKey(sha)) return;
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: "Commit not loaded",
        description: "Load older commits or clear the filters to reach it.",
      }),
    );
  });
  const jumpToWorktree = useStableCallback(
    (worktree: Pick<VcsRepositoryWorktree, "path" | "sha">) => {
      if (jumpToKey(worktreeRowKey(worktree.path))) return;
      jumpToSha(worktree.sha);
    },
  );
  const onSelect = useStableCallback((key: string) =>
    setSelectedKey((current) => (!wide && current === key ? null : key)),
  );
  const onLoadMore = useStableCallback(() =>
    loadMoreError !== null
      ? registry.refresh(pages.queries[lastIndex]!)
      : setPageState({ resetKey, count: pageCount + 1 }),
  );

  const retry = () => {
    for (const query of pages.queries) registry.refresh(query);
    refsQuery.refresh();
  };

  if (refs !== null && !refs.isRepo) {
    return (
      <div ref={rootRef} className="flex h-full min-h-0 flex-col">
        <GraphEmpty
          title="Not a Git repository"
          description="The Git graph needs a project that is a Git repository."
        />
      </div>
    );
  }

  const isLoading =
    firstResult === undefined || (firstResult._tag === "Initial" && firstError === null);
  const body = firstError ? (
    <GraphEmpty
      title="Could not load the graph"
      description={firstError}
      action={
        <Button variant="outline" size="xs" onClick={retry}>
          Retry
        </Button>
      }
    />
  ) : isLoading ? (
    <GraphSkeleton />
  ) : model.rows.length === 0 ? (
    <GraphEmpty
      title={
        allCommits.length === 0 && term === "" && ref === undefined
          ? "No commits yet"
          : "No matching commits"
      }
      description={
        allCommits.length === 0 && term === "" && ref === undefined
          ? "Commit something and it appears here."
          : "Change the branch, author or search to see more."
      }
    />
  ) : (
    <GitGraphList
      model={model}
      selectedKey={selectedRow?.key ?? null}
      compact={!wide}
      hasMore={hasMore || loadingMore || loadMoreError !== null}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      listRef={listRef}
      onSelect={onSelect}
      onExpand={onExpand}
      onLoadMore={onLoadMore}
    />
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-0 min-w-0 flex-col" data-git-graph-surface>
      <GitGraphToolbar
        wide={wide}
        branchValue={branchValue}
        localBranches={localBranches}
        worktreePaths={worktreePaths}
        onBranchChange={setBranchValue}
        onJumpToWorktree={(path) => {
          const worktree = refs?.worktrees.find((candidate) => candidate.path === path);
          if (worktree) jumpToWorktree(worktree);
        }}
        authors={authors}
        author={author}
        onAuthorChange={setAuthor}
        search={search}
        onSearchChange={setSearch}
        firstParent={firstParent}
        onFirstParentChange={setFirstParent}
        allRemoteBranches={allRemoteBranches}
        onAllRemoteBranchesChange={setAllRemoteBranches}
        collapseLinear={collapseLinear}
        onCollapseLinearChange={setCollapseLinear}
        onExpandAll={
          collapseLinear && model.collapsedKeys.length > 0
            ? () => expand(model.collapsedKeys)
            : null
        }
        loadedCount={allCommits.length}
      />
      <div className="flex min-h-0 flex-1">
        {wide && refs ? (
          <GitGraphRefsColumn
            refs={refs}
            colorBySha={model.colorBySha}
            worktreeLinks={worktreeLinks}
            onSelectSha={jumpToSha}
            onSelectWorktree={jumpToWorktree}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
        {wide && selectedRow ? (
          <div className="flex min-h-0 shrink-0 p-2 ps-0">
            <GitGraphDetails
              row={selectedRow}
              environmentId={environmentId}
              threadRef={threadRef}
              cwd={cwd}
              layout="column"
            />
          </div>
        ) : null}
      </div>
      {!wide && selectedRow ? (
        <GitGraphDetails
          row={selectedRow}
          environmentId={environmentId}
          threadRef={threadRef}
          cwd={cwd}
          layout="card"
        />
      ) : null}
    </div>
  );
}

export default function GitGraphPanel(props: {
  threadRef: ScopedThreadRef;
  visible: boolean;
  workspaceMutationId: string | null;
}) {
  const thread = useQuietThreadShell(props.threadRef);
  const project = useProject(
    thread ? scopeProjectRef(thread.environmentId, thread.projectId) : null,
  );
  const cwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  if (!props.visible || thread === null || cwd === null) {
    return (
      <GraphEmpty
        title="Git graph unavailable"
        description="Open a thread in a project to see its repository."
      />
    );
  }
  return (
    <GitGraphSurface
      threadRef={props.threadRef}
      projectId={thread.projectId}
      cwd={cwd}
      workspaceMutationId={props.workspaceMutationId}
    />
  );
}
