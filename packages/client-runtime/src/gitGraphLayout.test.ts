import { describe, expect, it } from "vite-plus/test";

import { layoutGitGraph, type GitGraphInputCommit, type GitGraphLine } from "./gitGraphLayout.ts";

const commits = (...specs: ReadonlyArray<string>): ReadonlyArray<GitGraphInputCommit> =>
  specs.map((spec) => {
    const [sha = "", parents = ""] = spec.split(":");
    return { sha, parents: parents === "" ? [] : parents.split(",") };
  });

const top = (from: number, to: number, color: number): GitGraphLine => ({
  fromLane: from,
  toLane: to,
  part: "top",
  color,
});
const bottom = (from: number, to: number, color: number): GitGraphLine => ({
  fromLane: from,
  toLane: to,
  part: "bottom",
  color,
});
const full = (lane: number, color: number): GitGraphLine => ({
  fromLane: lane,
  toLane: lane,
  part: "full",
  color,
});

const shift = (from: number, to: number, color: number): GitGraphLine => ({
  fromLane: from,
  toLane: to,
  part: "full",
  color,
});

const summary = (specs: ReadonlyArray<string>, options?: Parameters<typeof layoutGitGraph>[1]) =>
  layoutGitGraph(commits(...specs), options).rows.map((row) => ({
    sha: row.sha,
    lane: row.lane,
    color: row.color,
    lines: row.lines,
  }));

describe("layoutGitGraph", () => {
  it("lays out linear history in one lane", () => {
    const layout = layoutGitGraph(commits("c:b", "b:a", "a:"));
    expect(layout.width).toBe(1);
    expect(layout.rows.map((row) => [row.lane, row.color, row.hasChildren, row.width])).toEqual([
      [0, 0, false, 1],
      [0, 0, true, 1],
      [0, 0, true, 1],
    ]);
    expect(layout.rows.map((row) => row.lines)).toEqual([
      [bottom(0, 0, 0)],
      [top(0, 0, 0), bottom(0, 0, 0)],
      [top(0, 0, 0)],
    ]);
  });

  it("returns an empty layout for no commits", () => {
    expect(layoutGitGraph([])).toEqual({ rows: [], width: 0 });
  });

  it("splits a merge into a new coloured lane and converges it at the fork point", () => {
    expect(summary(["m:a,b", "a:r", "b:r", "r:"])).toEqual([
      { sha: "m", lane: 0, color: 0, lines: [bottom(0, 0, 0), bottom(0, 1, 1)] },
      { sha: "a", lane: 0, color: 0, lines: [top(0, 0, 0), full(1, 1), bottom(0, 0, 0)] },
      { sha: "b", lane: 1, color: 1, lines: [full(0, 0), top(1, 1, 1), bottom(1, 1, 1)] },
      { sha: "r", lane: 0, color: 0, lines: [top(0, 0, 0), top(1, 0, 1)] },
    ]);
    expect(layoutGitGraph(commits("m:a,b", "a:r", "b:r", "r:")).width).toBe(2);
  });

  it("reuses a lane freed by a finished branch", () => {
    expect(summary(["x:a,b", "b:", "t:a", "a:"])).toEqual([
      { sha: "x", lane: 0, color: 0, lines: [bottom(0, 0, 0), bottom(0, 1, 1)] },
      { sha: "b", lane: 1, color: 1, lines: [full(0, 0), top(1, 1, 1)] },
      { sha: "t", lane: 1, color: 2, lines: [full(0, 0), bottom(1, 1, 2)] },
      { sha: "a", lane: 0, color: 0, lines: [top(0, 0, 0), top(1, 0, 2)] },
    ]);
  });

  it("handles an octopus merge", () => {
    expect(summary(["o:a,b,c", "a:", "b:", "c:"])).toEqual([
      { sha: "o", lane: 0, color: 0, lines: [bottom(0, 0, 0), bottom(0, 1, 1), bottom(0, 2, 2)] },
      { sha: "a", lane: 0, color: 0, lines: [top(0, 0, 0), shift(1, 0, 1), shift(2, 1, 2)] },
      { sha: "b", lane: 0, color: 1, lines: [top(0, 0, 1), shift(1, 0, 2)] },
      { sha: "c", lane: 0, color: 2, lines: [top(0, 0, 2)] },
    ]);
  });

  it("points a later parent at a lane that already expects it", () => {
    expect(summary(["p:a,b", "q:b,a", "a:", "b:"])[1]?.lines).toEqual([
      full(0, 0),
      full(1, 1),
      bottom(2, 2, 2),
      bottom(2, 0, 0),
    ]);
  });

  it("gives each root its own start", () => {
    expect(summary(["r1:", "r2:"])).toEqual([
      { sha: "r1", lane: 0, color: 0, lines: [] },
      { sha: "r2", lane: 0, color: 1, lines: [] },
    ]);
  });

  it("puts a branch tip nobody expects in the leftmost free lane", () => {
    const layout = layoutGitGraph(commits("t1:r", "t2:r", "r:"));
    expect(layout.rows.map((row) => [row.lane, row.color, row.hasChildren])).toEqual([
      [0, 0, false],
      [1, 1, false],
      [0, 0, true],
    ]);
    expect(layout.rows[1]?.lines).toEqual([full(0, 0), bottom(1, 1, 1)]);
    expect(layout.rows[2]?.lines).toEqual([top(0, 0, 0), top(1, 0, 1)]);
  });

  describe("missing parents", () => {
    const history = ["m:a,b", "a:x", "b:y"];

    it("extend keeps lanes running to the bottom of the last row", () => {
      const rows = summary(history);
      expect(rows[1]?.lines).toEqual([top(0, 0, 0), full(1, 1), bottom(0, 0, 0)]);
      expect(rows[2]?.lines).toEqual([full(0, 0), top(1, 1, 1), bottom(1, 1, 1)]);
    });

    it("drop draws nothing toward a missing parent", () => {
      const rows = summary(history, { missingParents: "drop" });
      expect(rows[1]?.lines).toEqual([top(0, 0, 0), shift(1, 0, 1)]);
      expect(rows[2]?.lines).toEqual([top(0, 0, 1)]);
      expect(summary(["a:x"], { missingParents: "drop" })[0]?.lines).toEqual([]);
    });

    it("drop continues in the node lane with the first known parent", () => {
      expect(summary(["m:gone,b", "b:"], { missingParents: "drop" })).toEqual([
        { sha: "m", lane: 0, color: 0, lines: [bottom(0, 0, 0)] },
        { sha: "b", lane: 0, color: 0, lines: [top(0, 0, 0)] },
      ]);
    });
  });

  it("ignores later duplicate shas", () => {
    const layout = layoutGitGraph(commits("b:a", "a:", "b:a", "a:"));
    expect(layout.rows.map((row) => row.sha)).toEqual(["b", "a"]);
  });

  it("moves a lane right of a finished branch to the left within the row", () => {
    // Lanes: 0 = x, 1 = b (ends at b), 2 = c. After row b, c moves from lane 2 to lane 1.
    const layout = layoutGitGraph(commits("x:a,b,c", "b:", "c:a", "a:"));
    const rows = layout.rows;
    expect(rows[1]?.lines).toEqual([full(0, 0), top(1, 1, 1), shift(2, 1, 2)]);
    expect(rows[1]?.width).toBe(3);
    expect(rows[2]).toMatchObject({ sha: "c", lane: 1, color: 2 });
    expect(rows[2]?.lines).toEqual([full(0, 0), top(1, 1, 2), bottom(1, 1, 2)]);
    expect(rows[3]?.lines).toEqual([top(0, 0, 0), top(1, 0, 2)]);
    expect(layout.width).toBe(3);
  });

  it("keeps the width small when many short branches end", () => {
    const tips = Array.from({ length: 20 }, (_, i) => `t${i}:base`);
    const layout = layoutGitGraph(commits(...tips, "base:r", "r:"));
    expect(layout.rows[20]?.width).toBe(20);
    expect(layout.rows[20]?.lines.filter((line) => line.part === "top")).toHaveLength(20);
    expect(layout.rows[21]?.width).toBe(1);
    expect(layout.width).toBe(20);
  });

  it("handles 10,000 commits with periodic merges", () => {
    const count = 10_000;
    const input: GitGraphInputCommit[] = [];
    for (let i = 0; i < count; i++) {
      const parents =
        i === count - 1
          ? []
          : i % 7 === 0 && i + 3 < count
            ? [`c${i + 1}`, `c${i + 3}`]
            : [`c${i + 1}`];
      input.push({ sha: `c${i}`, parents });
    }
    const layout = layoutGitGraph(input);
    expect(layout.rows).toHaveLength(count);
    expect(layout.rows.map((row) => row.sha)).toEqual(input.map((commit) => commit.sha));
    for (const row of layout.rows) {
      expect(row.width).toBeGreaterThan(row.lane);
      expect(row.width).toBeLessThanOrEqual(layout.width);
      for (const line of row.lines) {
        expect(Math.max(line.fromLane, line.toLane)).toBeLessThan(row.width);
      }
    }
    expect(layout.rows[count - 1]?.lines.every((line) => line.part === "top")).toBe(true);
  });
});
