import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { ChevronsUpDown } from "lucide-react";
import { memo, type RefObject } from "react";

import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { gitGraphLaneColor } from "./gitGraphPalette";
import { GitGraphMoreRefsBadge, GitGraphRefBadge } from "./GitGraphRefBadge";
import { pathBasename, type GitGraphDisplayRow, type GitGraphModel } from "./gitGraph.logic";

const ROW_HEIGHT = 28;
const LANE_SPACING = 16;
const MAX_VISIBLE_LANES_WIDE = 14;
const MAX_VISIBLE_LANES_NARROW = 6;
const MAX_ROW_BADGES_WIDE = 3;
const MAX_ROW_BADGES_NARROW = 2;
const STUB_LENGTH = 6;

const laneX = (lane: number) => LANE_SPACING / 2 + lane * LANE_SPACING;

/**
 * A line that ends on a lane beyond the visible ones would stop flat at the cell edge, so it
 * shows only as a short, faint stub at its visible end, or not at all when both ends are hidden.
 */
function linePath(
  from: number,
  to: number,
  part: "top" | "bottom" | "full",
  visibleLanes: number,
): { d: string; stub: boolean } | null {
  const y1 = part === "bottom" ? ROW_HEIGHT / 2 : 0;
  const y2 = part === "top" ? ROW_HEIGHT / 2 : ROW_HEIGHT;
  const fromHidden = from >= visibleLanes;
  const toHidden = to >= visibleLanes;
  if (fromHidden && toHidden) return null;
  if (fromHidden) return { d: `M${laneX(to)} ${y2 - STUB_LENGTH}V${y2}`, stub: true };
  if (toHidden) return { d: `M${laneX(from)} ${y1}V${y1 + STUB_LENGTH}`, stub: true };
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (x1 === x2) return { d: `M${x1} ${y1}V${y2}`, stub: false };
  const mid = (y1 + y2) / 2;
  return { d: `M${x1} ${y1}C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`, stub: false };
}

const LaneCell = memo(function LaneCell(props: {
  row: GitGraphDisplayRow;
  laneCount: number;
  uncommitted: boolean;
}) {
  const { row, laneCount, uncommitted } = props;
  const width = laneCount * LANE_SPACING;
  const color = gitGraphLaneColor(row.layout.color);
  const collapsed = row.collapsed !== null;
  const hiddenLane = row.layout.lane >= laneCount;
  const nodeX = laneX(Math.min(row.layout.lane, laneCount - 1));
  const hollow = uncommitted || collapsed || hiddenLane;
  return (
    <span className="relative flex shrink-0">
      <svg
        aria-hidden
        width={width}
        height={ROW_HEIGHT}
        viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
        className="shrink-0 overflow-hidden"
      >
        {row.layout.lines.map((line) => {
          const path = linePath(line.fromLane, line.toLane, line.part, laneCount);
          if (path === null) return null;
          return (
            <path
              key={`${line.part}:${line.fromLane}:${line.toLane}`}
              d={path.d}
              stroke={gitGraphLaneColor(line.color)}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeOpacity={path.stub ? 0.45 : undefined}
              fill="none"
              // Lines of a worktree tip row lead to its base commit and read as pending; the
              // lines through a collapsed row stand for the commits it hides.
              strokeDasharray={
                (uncommitted && line.part === "bottom") || (collapsed && line.part !== "full")
                  ? "2 3"
                  : undefined
              }
            />
          );
        })}
        {row.isHead ? (
          <circle
            cx={nodeX}
            cy={ROW_HEIGHT / 2}
            r={6.5}
            fill="none"
            strokeWidth={1.5}
            className="stroke-foreground"
          />
        ) : null}
        <circle
          cx={nodeX}
          cy={ROW_HEIGHT / 2}
          r={collapsed || hiddenLane ? 3 : 4}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={uncommitted ? "2 2" : undefined}
          fill={hollow ? undefined : color}
          className={hollow ? "fill-background" : undefined}
        />
      </svg>
      {hiddenLane ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="absolute size-3 -translate-x-1/2 -translate-y-1/2"
                style={{ left: nodeX, top: ROW_HEIGHT / 2 }}
              />
            }
          />
          <TooltipPopup side="top">On a hidden lane</TooltipPopup>
        </Tooltip>
      ) : null}
    </span>
  );
});

const GitGraphRowView = memo(function GitGraphRowView(props: {
  row: GitGraphDisplayRow;
  selected: boolean;
  compact: boolean;
  laneCount: number;
  columns: string;
  onSelect: (key: string) => void;
  onExpand: (key: string) => void;
}) {
  const { row, selected, compact, laneCount, columns } = props;
  const { commit, worktree, collapsed } = row;
  if (collapsed) {
    return (
      <button
        type="button"
        aria-label={`Expand ${collapsed.count} commits`}
        onClick={() => props.onExpand(row.key)}
        style={{ gridTemplateColumns: columns, height: ROW_HEIGHT }}
        className="grid w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <LaneCell row={row} laneCount={laneCount} uncommitted={false} />
        <span className="col-[2/-1] flex min-w-0 items-center gap-1.5">
          <ChevronsUpDown aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate tabular-nums">{collapsed.count} commits</span>
        </span>
      </button>
    );
  }
  const uncommitted = worktree !== null;
  const subject = uncommitted ? "Uncommitted changes" : (commit?.subject ?? "");
  const maxBadges = compact ? MAX_ROW_BADGES_NARROW : MAX_ROW_BADGES_WIDE;
  const visibleRefs = row.refs.slice(0, maxBadges);
  const hiddenRefs = row.refs.slice(maxBadges);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => props.onSelect(row.key)}
      style={{ gridTemplateColumns: columns, height: ROW_HEIGHT }}
      className={cn(
        "grid w-full cursor-pointer items-center gap-2 rounded-sm text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-foreground/[0.08]",
      )}
    >
      <LaneCell row={row} laneCount={laneCount} uncommitted={uncommitted} />
      <span className="flex min-w-0 items-center gap-1.5">
        {visibleRefs.map((badge) => (
          <GitGraphRefBadge
            key={badge.kind === "head" ? "head" : `${badge.kind}:${badge.name}`}
            badge={badge}
            color={row.layout.color}
          />
        ))}
        {hiddenRefs.length > 0 ? <GitGraphMoreRefsBadge hidden={hiddenRefs} /> : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  uncommitted ? "text-warning-foreground" : "text-foreground",
                )}
              />
            }
          >
            {subject}
            {uncommitted && worktree ? (
              <span className="ms-2 text-muted-foreground">
                {worktree.changedFiles} files · {pathBasename(worktree.path)}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipPopup side="top" className="max-w-80">
            {subject}
          </TooltipPopup>
        </Tooltip>
      </span>
      {compact ? null : (
        <span className="truncate text-muted-foreground">{commit?.authorName ?? ""}</span>
      )}
      <span className="truncate text-right text-muted-foreground tabular-nums">
        {commit ? formatRelativeTimeLabel(commit.authoredAt) : ""}
      </span>
      {compact ? null : (
        <span className="truncate pe-2 font-mono text-muted-foreground">
          {commit ? commit.sha.slice(0, 7) : ""}
        </span>
      )}
    </button>
  );
});

export function GitGraphList(props: {
  model: GitGraphModel;
  selectedKey: string | null;
  compact: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
  listRef: RefObject<LegendListRef | null>;
  onSelect: (key: string) => void;
  onExpand: (key: string) => void;
  onLoadMore: () => void;
}) {
  const { model, compact, listRef } = props;
  const laneCount = Math.max(
    1,
    Math.min(model.layout.width, compact ? MAX_VISIBLE_LANES_NARROW : MAX_VISIBLE_LANES_WIDE),
  );
  const rowInputs = `${props.selectedKey ?? ""}|${compact}|${laneCount}`;
  const columns = compact
    ? `${laneCount * LANE_SPACING}px minmax(0,1fr) 3.5rem`
    : `${laneCount * LANE_SPACING}px minmax(0,1fr) 8rem 4rem 4.5rem`;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {compact ? null : (
        <div
          style={{ gridTemplateColumns: columns }}
          className="grid h-6 shrink-0 items-center gap-2 border-b border-border/60 px-1.5 text-2xs text-muted-foreground"
        >
          <span>Graph</span>
          <span>Message</span>
          <span>Author</span>
          <span className="text-right">Date</span>
          <span>Commit</span>
        </div>
      )}
      <LegendList<GitGraphDisplayRow>
        ref={listRef}
        data={model.rows as GitGraphDisplayRow[]}
        keyExtractor={(row) => row.key}
        extraData={rowInputs}
        renderItem={({ item }) => (
          <GitGraphRowView
            row={item}
            selected={item.key === props.selectedKey}
            compact={compact}
            laneCount={laneCount}
            columns={columns}
            onSelect={props.onSelect}
            onExpand={props.onExpand}
          />
        )}
        estimatedItemSize={ROW_HEIGHT}
        drawDistance={ROW_HEIGHT * 20}
        className="min-h-0 flex-1 overscroll-contain p-1.5"
        ListFooterComponent={
          props.hasMore ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs">
              {props.loadMoreError ? (
                <span className="min-w-0 truncate text-destructive-foreground">
                  {props.loadMoreError}
                </span>
              ) : null}
              <Button
                variant="outline"
                size="xs"
                disabled={props.loadingMore}
                onClick={props.onLoadMore}
              >
                {props.loadMoreError
                  ? "Retry"
                  : props.loadingMore
                    ? "Loading older commits"
                    : "Load older commits"}
              </Button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
