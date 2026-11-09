import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Copy, FileDiff, File as FileIcon } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useDiffPanelStore } from "~/diffPanelStore";
import { selectActiveRightPanel, useRightPanelStore } from "~/rightPanelStore";
import { gitGraphEnvironment } from "~/state/gitGraph";
import { useEnvironmentQuery } from "~/state/query";
import {
  showAnchoredCopyErrorToast,
  showAnchoredCopySuccessToast,
  ANCHORED_COPY_TOAST_TIMEOUT_MS,
} from "../ui/anchoredCopyToast";
import { Button } from "../ui/button";
import { MiddleTruncate } from "../ui/middle-truncate";
import { ScrollArea } from "../ui/scroll-area";
import { Skeleton } from "../ui/skeleton";
import { formatCompactDiffCount } from "../chat/DiffStatLabel";
import { GitGraphRefBadge } from "./GitGraphRefBadge";
import { columnMaxSize, GitGraphResizeHandle } from "./GitGraphResizeHandle";
import {
  formatCommitDate,
  pathBasename,
  refBadgeLabel,
  type GitGraphDisplayRow,
} from "./gitGraph.logic";

function openCommitInDiff(threadRef: ScopedThreadRef, sha: string) {
  const diffOpen =
    selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef) === "diff";
  useDiffPanelStore.getState().selectCommit(threadRef, sha, !diffOpen);
  useRightPanelStore.getState().open(threadRef, "diff");
}

function openUncommittedInDiff(threadRef: ScopedThreadRef) {
  useDiffPanelStore.getState().selectGitScope(threadRef, "unstaged");
  useRightPanelStore.getState().open(threadRef, "diff");
}

function CopyHashButton({ sha }: { sha: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { copyToClipboard } = useCopyToClipboard<void>({
    onCopy: () => showAnchoredCopySuccessToast(ref),
    onError: (error) => showAnchoredCopyErrorToast(ref, error),
    timeout: ANCHORED_COPY_TOAST_TIMEOUT_MS,
  });
  return (
    <Button ref={ref} variant="outline" size="xs" onClick={() => copyToClipboard(sha, undefined)}>
      <Copy />
      Copy hash
    </Button>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 break-words text-foreground">{props.children}</dd>
    </>
  );
}

function RefBadges({ row }: { row: GitGraphDisplayRow }) {
  if (row.refs.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {row.refs.map((badge) => (
        <GitGraphRefBadge
          key={badge.kind === "head" ? "head" : `${badge.kind}:${badge.name}`}
          badge={badge}
          color={row.layout.color}
        />
      ))}
    </div>
  );
}

const CARD_HEIGHT_KEY = "t3code.gitGraph.detailsCardHeight";
const CARD_HEIGHT_DEFAULT = 224;
const CARD_HEIGHT_MIN = 160;
const CARD_HEIGHT_MAX_RATIO = 0.7;

/** The card sits in the surface root, whose height bounds the card at 70%. */
function maxCardHeight(card: HTMLElement): number {
  const surface = card.parentElement?.clientHeight ?? 0;
  return Math.max(CARD_HEIGHT_MIN, Math.floor(surface * CARD_HEIGHT_MAX_RATIO));
}

const COLUMN_WIDTH_KEY = "t3code.gitGraph.detailsColumnWidth";
const COLUMN_WIDTH_DEFAULT = 320;
const COLUMN_WIDTH_MIN = 260;
const COLUMN_WIDTH_MAX = 560;
const maxColumnWidth = columnMaxSize(COLUMN_WIDTH_MAX, COLUMN_WIDTH_MIN);

/** The wide layout gives the card its own column; the narrow one a resizable card under the graph. */
function DetailsShell(props: { layout: "column" | "card"; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useLocalStorage(CARD_HEIGHT_KEY, CARD_HEIGHT_DEFAULT, Schema.Number);
  const [width, setWidth] = useLocalStorage(COLUMN_WIDTH_KEY, COLUMN_WIDTH_DEFAULT, Schema.Number);
  const body = (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-3 p-3 text-card-foreground">{props.children}</div>
    </ScrollArea>
  );
  if (props.layout === "column") {
    return (
      <div
        ref={columnRef}
        data-git-graph-column
        style={{ width: Math.min(COLUMN_WIDTH_MAX, Math.max(COLUMN_WIDTH_MIN, width)) }}
        className="relative flex min-h-0 shrink-0"
      >
        <div className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-card">
          {body}
        </div>
        <GitGraphResizeHandle
          orientation="vertical"
          targetRef={columnRef}
          size={width}
          defaultSize={COLUMN_WIDTH_DEFAULT}
          minSize={COLUMN_WIDTH_MIN}
          maxSize={maxColumnWidth}
          ariaMax={COLUMN_WIDTH_MAX}
          growDirection={-1}
          label="Resize commit details"
          onSizeChange={setWidth}
          className="-left-[3px]"
        />
      </div>
    );
  }
  return (
    <div
      ref={cardRef}
      style={{ height: Math.max(CARD_HEIGHT_MIN, height), maxHeight: "70%" }}
      className="m-2 flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border bg-card"
    >
      <GitGraphResizeHandle
        orientation="horizontal"
        targetRef={cardRef}
        size={height}
        defaultSize={CARD_HEIGHT_DEFAULT}
        minSize={CARD_HEIGHT_MIN}
        maxSize={maxCardHeight}
        growDirection={-1}
        label="Resize details"
        onSizeChange={setHeight}
      />
      {body}
    </div>
  );
}

export function GitGraphDetails(props: {
  row: GitGraphDisplayRow;
  environmentId: EnvironmentId;
  threadRef: ScopedThreadRef;
  cwd: string;
  /** The wide layout puts the card in its own column; the narrow one under the graph. */
  layout: "column" | "card";
}) {
  const { row } = props;
  const sha = row.commit?.sha ?? null;
  const detailsQuery = useEnvironmentQuery(
    sha === null
      ? null
      : gitGraphEnvironment.commitDetails({
          environmentId: props.environmentId,
          input: { cwd: props.cwd, sha },
        }),
  );
  const details = detailsQuery.data;
  if (row.worktree) {
    const worktree = row.worktree;
    return (
      <DetailsShell layout={props.layout}>
        <div className="text-sm font-medium text-warning-foreground">Uncommitted changes</div>
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <Field label="Folder">{pathBasename(worktree.path)}</Field>
          <Field label="Files">{worktree.changedFiles}</Field>
          <Field label="Based on">
            <span className="font-mono">{worktree.sha?.slice(0, 7)}</span>
          </Field>
        </dl>
        {worktree.isCurrent ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={() => openUncommittedInDiff(props.threadRef)}
            >
              <FileDiff />
              Open in Diff
            </Button>
          </div>
        ) : null}
      </DetailsShell>
    );
  }

  const commit = row.commit;
  if (commit === null || sha === null) return null;
  const subject = details?.subject ?? commit.subject;
  return (
    <DetailsShell layout={props.layout}>
      <RefBadges row={row} />
      <div className="text-sm font-medium text-foreground">{subject}</div>
      {details?.body ? (
        <p className="whitespace-pre-line text-sm text-foreground/75">{details.body}</p>
      ) : null}
      <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
        <Field label="Commit">
          <span className="font-mono">{sha}</span>
        </Field>
        <Field label="Parents">
          {(details?.parents ?? commit.parents).length === 0 ? (
            "None"
          ) : (
            <span className="font-mono">
              {(details?.parents ?? commit.parents).map((parent) => parent.slice(0, 7)).join(", ")}
            </span>
          )}
        </Field>
        <Field label="Author">{details?.authorName ?? commit.authorName}</Field>
        <Field label="Date">{formatCommitDate(details?.authoredAt ?? commit.authoredAt)}</Field>
        {row.refs.length > 0 ? (
          <Field label="On">{row.refs.map(refBadgeLabel).join(", ")}</Field>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <CopyHashButton sha={sha} />
        <Button variant="outline" size="xs" onClick={() => openCommitInDiff(props.threadRef, sha)}>
          <FileDiff />
          Open in Diff
        </Button>
      </div>
      {detailsQuery.error ? (
        <div className="flex items-center justify-between gap-2 text-xs text-destructive-foreground">
          <span className="min-w-0 truncate">{detailsQuery.error}</span>
          <Button variant="outline" size="xs" onClick={detailsQuery.refresh}>
            Retry
          </Button>
        </div>
      ) : details === null ? (
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-foreground">
              {details.files.length} changed {details.files.length === 1 ? "file" : "files"}
              {details.filesTruncated ? " (truncated)" : ""}
            </span>
            <span className="font-mono tabular-nums">
              <span className="text-diff-addition-foreground">
                +{formatCompactDiffCount(sum(details.files.map((file) => file.additions)))}
              </span>{" "}
              <span className="text-diff-deletion-foreground">
                -{formatCompactDiffCount(sum(details.files.map((file) => file.deletions)))}
              </span>
            </span>
          </div>
          <ul className="flex flex-col">
            {details.files.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => openCommitInDiff(props.threadRef, sha)}
                >
                  <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <MiddleTruncate value={file.path} className="flex-1" />
                  <span className="shrink-0 font-mono tabular-nums">
                    {file.additions === null || file.deletions === null ? (
                      <span className="text-muted-foreground">binary</span>
                    ) : (
                      <>
                        <span className="text-diff-addition-foreground">+{file.additions}</span>{" "}
                        <span className="text-diff-deletion-foreground">-{file.deletions}</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </DetailsShell>
  );
}

function sum(values: ReadonlyArray<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}
