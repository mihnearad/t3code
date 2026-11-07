import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";

const UNKNOWN_WORKSPACE_PREFIX = "t3code-unknown-workspace-";
const layerKnownWorkspacesTest = Layer.mock(KnownWorkspaces.KnownWorkspaces)({
  assertContains: (cwd) =>
    cwd.includes(UNKNOWN_WORKSPACE_PREFIX)
      ? Effect.fail(new KnownWorkspaces.UnknownWorkspaceError({ cwd }))
      : Effect.void,
});

const layerEntries = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));
const layerTest = Layer.empty.pipe(
  Layer.provideMerge(
    WorkspaceFileSystem.layer.pipe(
      Layer.provide(layerKnownWorkspacesTest),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(layerEntries),
    ),
  ),
  Layer.provideMerge(layerEntries),
  Layer.provideMerge(WorkspacePaths.layer),
  Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-workspace-mutations-test-" }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-workspace-mutations-" });
});

it.layer(layerTest, { excludeTestServices: true })("WorkspaceFileSystem entry mutations", (it) => {
  describe("createDirectory", () => {
    it.effect("creates a folder with its missing parents and lists it", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* workspaceEntries.list({ cwd });

        const result = yield* workspaceFileSystem.createDirectory({
          cwd,
          relativePath: "docs/notes",
        });

        expect(result).toEqual({ relativePath: "docs/notes" });
        expect((yield* fileSystem.stat(path.join(cwd, "docs/notes"))).type).toBe("Directory");
        const listed = yield* workspaceEntries.list({ cwd });
        expect(listed.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "docs/notes" })]),
        );
      }),
    );

    it.effect("refuses an existing file or folder and leaves it unchanged", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src"));
        yield* fileSystem.writeFileString(path.join(cwd, "src/keep.ts"), "keep\n");
        yield* fileSystem.writeFileString(path.join(cwd, "README.md"), "readme\n");

        for (const relativePath of ["src", "README.md"]) {
          const error = yield* workspaceFileSystem
            .createDirectory({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFileSystemOperationError);
          expect(error).toMatchObject({ operation: "make-directory" });
        }
        expect(yield* fileSystem.readDirectory(path.join(cwd, "src"))).toEqual(["keep.ts"]);
        expect(yield* fileSystem.readFileString(path.join(cwd, "README.md"))).toBe("readme\n");
      }),
    );

    it.effect("refuses folders outside the root, in git's folders, or in unknown workspaces", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, ".git"));

        for (const relativePath of ["../escape", path.join(outsideDir, "abs")]) {
          const error = yield* workspaceFileSystem
            .createDirectory({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
        }
        for (const relativePath of [".git/hooks", "sub/.git", ".GIT"]) {
          const error = yield* workspaceFileSystem
            .createDirectory({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        }
        const unknown = yield* fileSystem.makeTempDirectoryScoped({
          prefix: UNKNOWN_WORKSPACE_PREFIX,
        });
        const unknownError = yield* workspaceFileSystem
          .createDirectory({ cwd: unknown, relativePath: "new" })
          .pipe(Effect.flip);
        expect(unknownError).toBeInstanceOf(KnownWorkspaces.UnknownWorkspaceError);

        expect(yield* fileSystem.exists(path.resolve(cwd, "../escape"))).toBe(false);
        expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
        expect(yield* fileSystem.readDirectory(path.join(cwd, ".git"))).toEqual([]);
        expect(yield* fileSystem.exists(path.join(cwd, "sub"))).toBe(false);
        expect(yield* fileSystem.readDirectory(unknown)).toEqual([]);
      }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "refuses folders through a symlink that leaves the workspace",
      () =>
        Effect.gen(function* () {
          const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          const outsideDir = yield* makeTempDir;
          yield* fileSystem.symlink(outsideDir, path.join(cwd, "linked"));

          for (const relativePath of ["linked/new", "linked/nested/new"]) {
            const error = yield* workspaceFileSystem
              .createDirectory({ cwd, relativePath })
              .pipe(Effect.flip);
            expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
          }
          expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
        }),
    );
  });

  describe("moveEntry", () => {
    it.effect("renames files and folders and moves them into folders", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "src/lib"), { recursive: true });
        yield* fileSystem.writeFileString(path.join(cwd, "src/lib/a.ts"), "a\n");
        yield* fileSystem.writeFileString(path.join(cwd, "notes.md"), "notes\n");
        yield* fileSystem.makeDirectory(path.join(cwd, "docs"));
        yield* workspaceEntries.list({ cwd });

        const moves = [
          ["notes.md", "readme.md"],
          ["readme.md", "docs/readme.md"],
          ["src/lib", "src/core"],
          ["src/core", "docs/core"],
        ] as const;
        for (const [fromPath, toPath] of moves) {
          expect(yield* workspaceFileSystem.moveEntry({ cwd, fromPath, toPath })).toEqual({
            relativePath: toPath,
          });
        }

        expect(yield* fileSystem.readFileString(path.join(cwd, "docs/readme.md"))).toBe("notes\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "docs/core/a.ts"))).toBe("a\n");
        expect((yield* fileSystem.readDirectory(cwd)).toSorted()).toEqual(["docs", "src"]);
        expect(yield* fileSystem.readDirectory(path.join(cwd, "src"))).toEqual([]);
        const listed = (yield* workspaceEntries.list({ cwd })).entries.map((entry) => entry.path);
        expect(listed).toEqual(expect.arrayContaining(["docs/readme.md", "docs/core/a.ts"]));
        expect(listed).not.toContain("notes.md");
      }),
    );

    it.effect("never replaces an existing file or folder", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.writeFileString(path.join(cwd, "a.md"), "a\n");
        yield* fileSystem.writeFileString(path.join(cwd, "b.md"), "b\n");
        yield* fileSystem.makeDirectory(path.join(cwd, "x"));
        yield* fileSystem.makeDirectory(path.join(cwd, "y"));

        for (const [fromPath, toPath] of [
          ["a.md", "b.md"],
          ["x", "y"],
          ["a.md", "x"],
        ] as const) {
          const error = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath, toPath })
            .pipe(Effect.flip);
          expect(error).toMatchObject({ operation: "rename" });
        }
        expect(yield* fileSystem.readFileString(path.join(cwd, "a.md"))).toBe("a\n");
        expect(yield* fileSystem.readFileString(path.join(cwd, "b.md"))).toBe("b\n");
        expect((yield* fileSystem.readDirectory(cwd)).toSorted()).toEqual([
          "a.md",
          "b.md",
          "x",
          "y",
        ]);
      }),
    );

    it.effect("refuses moves out of the root, into or out of git's folders, and of the root", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, ".git"));
        yield* fileSystem.writeFileString(path.join(cwd, ".git/config"), "[core]\n");
        yield* fileSystem.writeFileString(path.join(cwd, "a.md"), "a\n");

        for (const [fromPath, toPath] of [
          ["a.md", "../a.md"],
          ["a.md", path.join(outsideDir, "a.md")],
          ["../outside.md", "a2.md"],
        ] as const) {
          const error = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath, toPath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
        }
        for (const [fromPath, toPath] of [
          ["a.md", ".git/hooks"],
          [".git/config", "config"],
          [".git", "git-copy"],
        ] as const) {
          const error = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath, toPath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        }
        for (const [fromPath, toPath] of [
          [".", "moved-root"],
          ["missing.md", "found.md"],
        ] as const) {
          const error = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath, toPath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(Error);
        }

        expect((yield* fileSystem.readDirectory(cwd)).toSorted()).toEqual([".git", "a.md"]);
        expect(yield* fileSystem.readDirectory(path.join(cwd, ".git"))).toEqual(["config"]);
        expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
      }),
    );

    it.effect.skipIf(!symlinksSupported)(
      "refuses to move a symlink or to move through one that leaves the workspace",
      () =>
        Effect.gen(function* () {
          const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const cwd = yield* makeTempDir;
          const outsideDir = yield* makeTempDir;
          yield* fileSystem.writeFileString(path.join(cwd, "a.md"), "a\n");
          yield* fileSystem.symlink("a.md", path.join(cwd, "link.md"));
          yield* fileSystem.symlink(outsideDir, path.join(cwd, "out"));

          const linkError = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath: "link.md", toPath: "moved.md" })
            .pipe(Effect.flip);
          expect(linkError).toMatchObject({ operation: "rename" });
          const escapeError = yield* workspaceFileSystem
            .moveEntry({ cwd, fromPath: "a.md", toPath: "out/a.md" })
            .pipe(Effect.flip);
          expect(escapeError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);

          expect((yield* fileSystem.readDirectory(cwd)).toSorted()).toEqual([
            "a.md",
            "link.md",
            "out",
          ]);
          expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
        }),
    );
  });

  describe("deleteEntry", () => {
    it.effect("deletes a file and a folder with its contents", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "docs/deep"), { recursive: true });
        yield* fileSystem.writeFileString(path.join(cwd, "docs/deep/a.md"), "a\n");
        yield* fileSystem.writeFileString(path.join(cwd, "keep.md"), "keep\n");
        yield* fileSystem.writeFileString(path.join(cwd, "drop.md"), "drop\n");
        yield* workspaceEntries.list({ cwd });

        for (const relativePath of ["drop.md", "docs"]) {
          expect(yield* workspaceFileSystem.deleteEntry({ cwd, relativePath })).toEqual({
            relativePath,
          });
        }

        expect(yield* fileSystem.readDirectory(cwd)).toEqual(["keep.md"]);
        const listed = (yield* workspaceEntries.list({ cwd })).entries.map((entry) => entry.path);
        expect(listed).toEqual(["keep.md"]);
      }),
    );

    it.effect("refuses the root, git folders, nested repositories and missing paths", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, ".git"));
        yield* fileSystem.writeFileString(path.join(cwd, ".git/config"), "[core]\n");
        yield* fileSystem.makeDirectory(path.join(cwd, "vendor/lib/.git"), { recursive: true });
        yield* fileSystem.makeDirectory(path.join(cwd, "apps/web/deep"), { recursive: true });
        yield* fileSystem.writeFileString(path.join(cwd, "apps/web/deep/.git"), "gitdir: x\n");
        yield* fileSystem.writeFileString(path.join(outsideDir, "o.md"), "o\n");

        for (const relativePath of ["missing.md", "vendor/lib", "vendor", "apps"]) {
          const error = yield* workspaceFileSystem
            .deleteEntry({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toMatchObject({ operation: "remove" });
        }
        for (const relativePath of [".git", ".git/config"]) {
          const error = yield* workspaceFileSystem
            .deleteEntry({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        }
        for (const relativePath of [".", "../outside", path.join(outsideDir, "o.md")]) {
          const error = yield* workspaceFileSystem
            .deleteEntry({ cwd, relativePath })
            .pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
        }

        expect(yield* fileSystem.readFileString(path.join(cwd, ".git/config"))).toBe("[core]\n");
        expect(yield* fileSystem.exists(path.join(cwd, "vendor/lib/.git"))).toBe(true);
        expect(yield* fileSystem.exists(path.join(cwd, "apps/web/deep/.git"))).toBe(true);
        expect(yield* fileSystem.readDirectory(outsideDir)).toEqual(["o.md"]);
      }),
    );

    it.effect.skipIf(!symlinksSupported)("removes a link without touching its target", () =>
      Effect.gen(function* () {
        const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "real"));
        yield* fileSystem.writeFileString(path.join(cwd, "real/a.md"), "a\n");
        yield* fileSystem.symlink("real", path.join(cwd, "link-dir"));
        yield* fileSystem.symlink("real/a.md", path.join(cwd, "link.md"));

        yield* workspaceFileSystem.deleteEntry({ cwd, relativePath: "link-dir" });
        yield* workspaceFileSystem.deleteEntry({ cwd, relativePath: "link.md" });

        expect(yield* fileSystem.readDirectory(cwd)).toEqual(["real"]);
        expect(yield* fileSystem.readFileString(path.join(cwd, "real/a.md"))).toBe("a\n");
      }),
    );
  });
});
