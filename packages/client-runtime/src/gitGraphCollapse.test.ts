import { describe, expect, it } from "vite-plus/test";

import { collapseLinearRuns } from "./gitGraphCollapse.ts";
import { layoutGitGraph, type GitGraphInputCommit } from "./gitGraphLayout.ts";

const commits = (...specs: ReadonlyArray<string>): ReadonlyArray<GitGraphInputCommit> =>
  specs.map((spec) => {
    const [sha = "", parents = ""] = spec.split(":");
    return { sha, parents: parents === "" ? [] : parents.split(",") };
  });

const chain = (length: number) =>
  commits(...Array.from({ length }, (_, i) => `c${i}:${i === length - 1 ? "" : `c${i + 1}`}`));

const collapse = (
  input: ReadonlyArray<GitGraphInputCommit>,
  options: {
    pinned?: ReadonlyArray<string>;
    expanded?: ReadonlyArray<string>;
    minHidden?: number;
  } = {},
) =>
  collapseLinearRuns(input, {
    isPinned: (sha) => options.pinned?.includes(sha) ?? false,
    expandedKeys: new Set(options.expanded ?? []),
    ...(options.minHidden === undefined ? {} : { minHidden: options.minHidden }),
  });

const label = (items: ReturnType<typeof collapse>) =>
  items.map((item) =>
    item.kind === "commit" ? item.commit.sha : `[${item.hiddenShas.join(",")}]`,
  );

describe("collapseLinearRuns", () => {
  it("collapses a linear chain to first, collapsed, last", () => {
    const items = collapse(chain(6));
    expect(label(items)).toEqual(["c0", "[c1,c2,c3,c4]", "c5"]);
    expect(items[0]?.graphCommit.parents).toEqual(["collapsed:c1"]);
    expect(items[1]).toMatchObject({
      kind: "collapsed",
      key: "c1",
      graphCommit: { sha: "collapsed:c1", parents: ["c5"] },
    });
    expect(items[2]?.graphCommit).toEqual({ sha: "c5", parents: [] });
  });

  it("splits a run at a pinned commit", () => {
    expect(label(collapse(chain(10), { pinned: ["c5"] }))).toEqual([
      "c0",
      "[c1,c2,c3,c4]",
      "c5",
      "[c6,c7,c8]",
      "c9",
    ]);
  });

  it("keeps an expanded run open", () => {
    expect(label(collapse(chain(6), { expanded: ["c1"] }))).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
  });

  it("keeps runs shorter than minHidden", () => {
    expect(label(collapse(chain(5)))).toEqual(["c0", "[c1,c2,c3]", "c4"]);
    expect(label(collapse(chain(4)))).toEqual(["c0", "c1", "c2", "c3"]);
    expect(label(collapse(chain(4), { minHidden: 2 }))).toEqual(["c0", "[c1,c2]", "c3"]);
  });

  it("splits a run at a merge and at commits with several children", () => {
    const merged = commits("m:a1,x", "a1:a2", "a2:a3", "a3:a4", "a4:a5", "a5:a6", "a6:", "x:a3");
    // a3 has two children (a2 and x) and x is not the next entry of its parent.
    const items = collapse(merged);
    expect(label(items)).toEqual(["m", "a1", "a2", "a3", "a4", "a5", "a6", "x"]);

    const mergeInside = commits(
      "t:b1",
      "b1:b2",
      "b2:b3,y",
      "b3:b4",
      "b4:b5",
      "b5:b6",
      "b6:b7",
      "b7:",
      "y:",
    );
    expect(label(collapse(mergeInside))).toEqual(["t", "b1", "b2", "b3", "[b4,b5,b6]", "b7", "y"]);
  });

  it("keeps the layout connected with one row per item", () => {
    const input = commits("m:a0,s0", "a0:a1", "a1:a2", "a2:a3", "a3:a4", "a4:r", "s0:r", "r:");
    const items = collapse(input);
    expect(label(items)).toEqual(["m", "a0", "[a1,a2,a3]", "a4", "s0", "r"]);
    const layout = layoutGitGraph(items.map((item) => item.graphCommit));
    expect(layout.rows.map((row) => row.sha)).toEqual(["m", "a0", "collapsed:a1", "a4", "s0", "r"]);
    const last = layout.rows[layout.rows.length - 1]!;
    expect(last.lines.every((line) => line.part === "top")).toBe(true);
    for (const row of layout.rows.slice(1)) expect(row.hasChildren).toBe(true);
  });

  it("lays a straight line out in a single lane", () => {
    const layout = layoutGitGraph(collapse(chain(50)).map((item) => item.graphCommit));
    expect(layout.rows).toHaveLength(3);
    expect(layout.width).toBe(1);
  });
});
