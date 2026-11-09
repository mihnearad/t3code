import { Link } from "@tanstack/react-router";
import type {
  VcsRepositoryBranch,
  VcsRepositoryRefsResult,
  VcsRepositoryWorktree,
} from "@t3tools/contracts";
import { Cloud, FolderGit2, Tag } from "lucide-react";
import * as Schema from "effect/Schema";
import { memo, useRef, useState, type ReactNode } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { gitGraphLaneColor } from "./gitGraphPalette";
import { columnMaxSize, GitGraphResizeHandle } from "./GitGraphResizeHandle";
import { pathBasename, worktreeBranchLabel, type WorktreeThreadLink } from "./gitGraph.logic";

const REF_ROW_CLASS =
  "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// Remote branches and tags can number in the thousands, so each section renders a page of rows.
const SECTION_PAGE = 100;
const DEFAULT_CLOSED: ReadonlySet<string> = new Set(["remote", "tags"]);

function NameWithTooltip(props: { name: string; tooltip: string; className: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={cn("min-w-0 truncate", props.className)} />}>
        {props.name}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

function Section(props: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  /** Rows beyond the cap that a "Show more" button reveals. */
  hidden?: number;
  onShowMore?: () => void;
  children: ReactNode;
}) {
  if (props.count === 0) return null;
  return (
    <section>
      <CollapsibleSectionHeader
        expanded={props.open}
        onClick={props.onToggle}
        variant="panel"
        accessory={<span className="text-muted-foreground tabular-nums">{props.count}</span>}
      >
        {props.title}
      </CollapsibleSectionHeader>
      {props.open ? (
        <div className="flex flex-col gap-px px-1 pb-1">
          {props.children}
          {props.hidden && props.onShowMore ? (
            <Button variant="ghost" size="xs" onClick={props.onShowMore}>
              Show {Math.min(props.hidden, SECTION_PAGE)} more
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function WorktreeRow(props: {
  worktree: VcsRepositoryWorktree;
  color: number | undefined;
  link: WorktreeThreadLink | null;
  onSelect: () => void;
}) {
  const { worktree, link } = props;
  const changed = worktree.changedFiles ?? 0;
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-sm px-2 py-1 text-xs hover:bg-accent",
        worktree.isCurrent && "bg-foreground/[0.08]",
      )}
    >
      <button
        type="button"
        onClick={props.onSelect}
        className="flex min-w-0 cursor-pointer items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <FolderGit2
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground"
          style={props.color === undefined ? undefined : { color: gitGraphLaneColor(props.color) }}
        />
        <NameWithTooltip
          name={pathBasename(worktree.path)}
          tooltip={worktree.path}
          className="font-medium text-foreground"
        />
        {worktree.isMain ? (
          <span className="shrink-0 text-muted-foreground">main checkout</span>
        ) : null}
        {changed > 0 ? (
          <span className="ms-auto shrink-0 text-warning-foreground tabular-nums">
            {changed} changed
          </span>
        ) : null}
      </button>
      <span className="truncate ps-5.5 text-muted-foreground">{worktreeBranchLabel(worktree)}</span>
      {link ? (
        <Link
          to="/$environmentId/$threadId"
          params={{ environmentId: link.thread.environmentId, threadId: link.thread.id }}
          className="truncate ps-5.5 text-info-foreground underline-offset-4 hover:underline"
        >
          {link.thread.title}
          {link.others > 0 ? <span className="text-muted-foreground"> +{link.others}</span> : null}
        </Link>
      ) : null}
    </div>
  );
}

const LocalBranchRow = memo(function LocalBranchRow(props: {
  branch: VcsRepositoryBranch;
  isHead: boolean;
  color: number | undefined;
  onSelectSha: (sha: string | null) => void;
}) {
  const { branch } = props;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={() => props.onSelectSha(branch.sha)}
            className={cn(REF_ROW_CLASS, props.isHead && "bg-foreground/[0.08]")}
          />
        }
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-muted-foreground"
          style={
            props.color === undefined
              ? undefined
              : { backgroundColor: gitGraphLaneColor(props.color) }
          }
        />
        <span className="min-w-0 truncate text-foreground">{branch.name}</span>
        {props.isHead ? (
          <Badge variant="default" size="sm">
            HEAD
          </Badge>
        ) : null}
        <span className="ms-auto flex shrink-0 gap-1.5 tabular-nums">
          {branch.ahead ? <span className="text-success-foreground">↑{branch.ahead}</span> : null}
          {branch.behind ? <span className="text-warning-foreground">↓{branch.behind}</span> : null}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="right">{branch.name}</TooltipPopup>
    </Tooltip>
  );
});

const PlainRefRow = memo(function PlainRefRow(props: {
  kind: "remote" | "tag";
  name: string;
  sha: string;
  onSelectSha: (sha: string | null) => void;
}) {
  const Icon = props.kind === "remote" ? Cloud : Tag;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={REF_ROW_CLASS}
            onClick={() => props.onSelectSha(props.sha)}
          />
        }
      >
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-muted-foreground">{props.name}</span>
      </TooltipTrigger>
      <TooltipPopup side="right">{props.name}</TooltipPopup>
    </Tooltip>
  );
});

const WIDTH_KEY = "t3code.gitGraph.refsColumnWidth";
const WIDTH_DEFAULT = 248;
const WIDTH_MIN = 180;
const WIDTH_MAX = 420;
const maxWidth = columnMaxSize(WIDTH_MAX, WIDTH_MIN);

function matches(text: string, needle: string) {
  return needle === "" || text.toLowerCase().includes(needle);
}

export const GitGraphRefsColumn = memo(function GitGraphRefsColumn(props: {
  refs: VcsRepositoryRefsResult;
  colorBySha: ReadonlyMap<string, number>;
  worktreeLinks: ReadonlyMap<string, WorktreeThreadLink | null>;
  onSelectSha: (sha: string | null) => void;
  onSelectWorktree: (worktree: VcsRepositoryWorktree) => void;
}) {
  const { refs, colorBySha, onSelectSha, onSelectWorktree } = props;
  const columnRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useLocalStorage(WIDTH_KEY, WIDTH_DEFAULT, Schema.Number);
  const [closed, setClosed] = useState<ReadonlySet<string>>(DEFAULT_CLOSED);
  const [filter, setFilter] = useState("");
  const [limits, setLimits] = useState<Readonly<Record<string, number>>>({});
  const needle = filter.trim().toLowerCase();
  const filtering = needle !== "";
  const toggle = (section: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(section)) next.add(section);
      return next;
    });
  const showMore = (section: string) =>
    setLimits((current) => ({
      ...current,
      [section]: (current[section] ?? SECTION_PAGE) + SECTION_PAGE,
    }));
  const lists = {
    worktrees: refs.worktrees.filter(
      (worktree) =>
        matches(worktree.path, needle) || matches(worktreeBranchLabel(worktree), needle),
    ),
    local: refs.branches.filter(
      (branch) => branch.kind === "local" && matches(branch.name, needle),
    ),
    remote: refs.branches.filter(
      (branch) => branch.kind === "remote" && matches(branch.name, needle),
    ),
    tags: refs.tags.filter((tag) => matches(tag.name, needle)),
  };
  // A filter opens every section so its matches are visible.
  const isOpen = (section: string) => filtering || !closed.has(section);
  const limitOf = (section: string) => limits[section] ?? SECTION_PAGE;
  const sectionProps = (section: "local" | "remote" | "tags") => ({
    count: lists[section].length,
    open: isOpen(section),
    onToggle: () => toggle(section),
    hidden: Math.max(0, lists[section].length - limitOf(section)),
    onShowMore: () => showMore(section),
  });
  return (
    <div
      ref={columnRef}
      data-git-graph-column
      style={{ width: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width)) }}
      className="relative h-full shrink-0 border-r border-border/60"
    >
      <ScrollArea>
        <div className="flex flex-col py-1">
          <div className="px-2 pb-1">
            <Input
              type="search"
              size="compact"
              aria-label="Filter refs"
              placeholder="Filter refs"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          <Section
            title="Worktrees"
            count={lists.worktrees.length}
            open={isOpen("worktrees")}
            onToggle={() => toggle("worktrees")}
          >
            {lists.worktrees.map((worktree) => (
              <WorktreeRow
                key={worktree.path}
                worktree={worktree}
                color={worktree.sha === null ? undefined : colorBySha.get(worktree.sha)}
                link={props.worktreeLinks.get(worktree.path) ?? null}
                onSelect={() => onSelectWorktree(worktree)}
              />
            ))}
          </Section>
          <Section title="Local branches" {...sectionProps("local")}>
            {lists.local.slice(0, limitOf("local")).map((branch) => (
              <LocalBranchRow
                key={branch.name}
                branch={branch}
                isHead={refs.head.branch === branch.name}
                color={colorBySha.get(branch.sha)}
                onSelectSha={onSelectSha}
              />
            ))}
          </Section>
          <Section title="Remote branches" {...sectionProps("remote")}>
            {lists.remote.slice(0, limitOf("remote")).map((branch) => (
              <PlainRefRow
                key={branch.name}
                kind="remote"
                name={branch.name}
                sha={branch.sha}
                onSelectSha={onSelectSha}
              />
            ))}
          </Section>
          <Section title="Tags" {...sectionProps("tags")}>
            {lists.tags.slice(0, limitOf("tags")).map((tag) => (
              <PlainRefRow
                key={tag.name}
                kind="tag"
                name={tag.name}
                sha={tag.sha}
                onSelectSha={onSelectSha}
              />
            ))}
          </Section>
        </div>
      </ScrollArea>
      <GitGraphResizeHandle
        orientation="vertical"
        targetRef={columnRef}
        size={width}
        defaultSize={WIDTH_DEFAULT}
        minSize={WIDTH_MIN}
        maxSize={maxWidth}
        ariaMax={WIDTH_MAX}
        growDirection={1}
        label="Resize refs column"
        onSizeChange={setWidth}
        className="-right-[3px]"
      />
    </div>
  );
});
