export interface GitGraphInputCommit {
  readonly sha: string;
  readonly parents: ReadonlyArray<string>;
}

export interface GitGraphLine {
  readonly fromLane: number;
  readonly toLane: number;
  // "top": (fromLane, row top) -> (toLane, row middle): a line that ends in this row's node.
  // "bottom": (fromLane, row middle) -> (toLane, row bottom): a line that leaves this row's node toward a parent.
  // "full": (fromLane, row top) -> (toLane, row bottom): a line that passes this row without touching the node.
  readonly part: "top" | "bottom" | "full";
  // Colour index of the branch line. The renderer maps it to a palette with `color % palette.length`.
  readonly color: number;
}

export interface GitGraphRow {
  readonly sha: string;
  readonly lane: number;
  readonly color: number;
  readonly lines: ReadonlyArray<GitGraphLine>;
  // Lanes used in this row (max lane index of the node and of all lines, plus one).
  readonly width: number;
  // True when the node has at least one child row above it in the list.
  readonly hasChildren: boolean;
}

export interface GitGraphLayout {
  readonly rows: ReadonlyArray<GitGraphRow>;
  // Max width over all rows.
  readonly width: number;
}

interface ActiveLane {
  readonly sha: string;
  readonly color: number;
}

export function layoutGitGraph(
  commits: ReadonlyArray<GitGraphInputCommit>,
  options?: {
    // "extend" (default): a parent that is not in `commits` keeps its lane running to the bottom of the
    // last row (more history can be loaded). "drop": no line is drawn toward such a parent (used for
    // filtered results such as a message search).
    readonly missingParents?: "extend" | "drop";
  },
): GitGraphLayout {
  const dropMissing = options?.missingParents === "drop";
  const known = new Set<string>();
  for (const commit of commits) known.add(commit.sha);

  const lanes: Array<ActiveLane | null> = [];
  const seen = new Set<string>();
  const rows: GitGraphRow[] = [];
  let nextColor = 0;
  let layoutWidth = 0;

  const leftmostFree = () => {
    const index = lanes.indexOf(null);
    return index === -1 ? lanes.length : index;
  };

  for (const commit of commits) {
    if (seen.has(commit.sha)) continue;
    seen.add(commit.sha);

    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i]?.sha === commit.sha) {
        lane = i;
        break;
      }
    }
    const hasChildren = lane !== -1;
    let color: number;
    if (hasChildren) {
      color = lanes[lane]!.color;
    } else {
      lane = leftmostFree();
      color = nextColor++;
    }

    const lines: GitGraphLine[] = [];
    let width = lane + 1;
    for (let i = 0; i < lanes.length; i++) {
      const active = lanes[i];
      if (!active) continue;
      if (active.sha === commit.sha) {
        lines.push({ fromLane: i, toLane: lane, part: "top", color: active.color });
        lanes[i] = null;
      } else {
        lines.push({ fromLane: i, toLane: i, part: "full", color: active.color });
      }
      if (i + 1 > width) width = i + 1;
    }

    let firstPlaced = false;
    for (const parent of commit.parents) {
      if (dropMissing && !known.has(parent)) continue;
      let target = -1;
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i]?.sha === parent) {
          target = i;
          break;
        }
      }
      if (!firstPlaced) {
        firstPlaced = true;
        lanes[lane] = { sha: parent, color };
        lines.push({ fromLane: lane, toLane: lane, part: "bottom", color });
        continue;
      }
      if (target !== -1) {
        lines.push({ fromLane: lane, toLane: target, part: "bottom", color: lanes[target]!.color });
      } else {
        target = leftmostFree();
        const parentColor = nextColor++;
        lanes[target] = { sha: parent, color: parentColor };
        lines.push({ fromLane: lane, toLane: target, part: "bottom", color: parentColor });
      }
      if (target + 1 > width) width = target + 1;
    }

    // Pack the active lanes to the left. Only lines that leave this row move; "top" lines and the node stay.
    const shift: number[] = [];
    let packed = 0;
    for (let i = 0; i < lanes.length; i++) {
      shift.push(packed);
      if (lanes[i]) lanes[packed++] = lanes[i]!;
    }
    if (packed < lanes.length) {
      lanes.length = packed;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.part === "top") continue;
        const toLane = shift[line.toLane]!;
        if (toLane !== line.toLane) lines[i] = { ...line, toLane };
      }
    }

    if (width > layoutWidth) layoutWidth = width;
    rows.push({ sha: commit.sha, lane, color, lines, width, hasChildren });
  }

  return { rows, width: layoutWidth };
}
