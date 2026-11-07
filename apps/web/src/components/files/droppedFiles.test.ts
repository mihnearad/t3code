import { describe, expect, it } from "@effect/vitest";

import { collectDroppedFiles, type DroppedEntry } from "./droppedFiles";

const fileEntry = (name: string, contents = name): DroppedEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (success) => success(new File([contents], name)),
});

// Hands entries back in batches of two, as browsers page readEntries.
const folderEntry = (name: string, children: DroppedEntry[]): DroppedEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let offset = 0;
    return {
      readEntries: (success) => {
        const batch = children.slice(offset, offset + 2);
        offset += batch.length;
        success(batch);
      },
    };
  },
});

describe("collectDroppedFiles", () => {
  it("walks dropped folders page by page and keeps their relative paths", async () => {
    const result = await collectDroppedFiles([
      fileEntry("top.txt"),
      folderEntry("site", [
        fileEntry("a.html"),
        fileEntry("b.css"),
        folderEntry("img", [fileEntry("logo.png")]),
      ]),
    ]);

    expect(result.files.map((dropped) => dropped.relativePath)).toEqual([
      "top.txt",
      "site/a.html",
      "site/b.css",
      "site/img/logo.png",
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("skips git folders, unreadable entries and files over the limit", async () => {
    const unreadable: DroppedEntry = {
      name: "locked.txt",
      isFile: true,
      isDirectory: false,
      file: (_success, failure) => failure?.(new Error("denied")),
    };
    const result = await collectDroppedFiles(
      [
        folderEntry("repo", [folderEntry(".git", [fileEntry("config")]), fileEntry("a.txt")]),
        unreadable,
        fileEntry("b.txt"),
        fileEntry("c.txt"),
      ],
      2,
    );

    expect(result.files.map((dropped) => dropped.relativePath)).toEqual(["repo/a.txt", "b.txt"]);
    expect(result.skipped).toEqual(["repo/.git", "locked.txt", "c.txt"]);
  });

  it("accepts plain files when the browser gives no entries", async () => {
    const result = await collectDroppedFiles([new File(["x"], "plain.bin")]);
    expect(result.files.map((dropped) => dropped.relativePath)).toEqual(["plain.bin"]);
  });
});
