import { describe, expect, it } from "@effect/vitest";

import { planFileTreeMoves } from "./fileTreeMove";

describe("planFileTreeMoves", () => {
  it("moves files and folders into a folder, keeping their names", () => {
    expect(
      planFileTreeMoves(["a.md", "src/lib/"], { kind: "directory", directoryPath: "docs/" }),
    ).toEqual([
      { fromPath: "a.md", toPath: "docs/a.md", fromTreePath: "a.md", toTreePath: "docs/a.md" },
      {
        fromPath: "src/lib",
        toPath: "docs/lib",
        fromTreePath: "src/lib/",
        toTreePath: "docs/lib/",
      },
    ]);
  });

  it("moves to the root and skips rows already in the target folder", () => {
    expect(planFileTreeMoves(["docs/a.md", "b.md"], { kind: "root", directoryPath: null })).toEqual(
      [{ fromPath: "docs/a.md", toPath: "a.md", fromTreePath: "docs/a.md", toTreePath: "a.md" }],
    );
    expect(
      planFileTreeMoves(["src/", "src/a.ts"], { kind: "directory", directoryPath: "docs/" }),
    ).toEqual([
      { fromPath: "src", toPath: "docs/src", fromTreePath: "src/", toTreePath: "docs/src/" },
    ]);
    expect(planFileTreeMoves(["docs/a.md"], { kind: "directory", directoryPath: "docs/" })).toEqual(
      [],
    );
  });
});
