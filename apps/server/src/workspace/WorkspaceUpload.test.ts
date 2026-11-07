import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { PROJECT_UPLOAD_URL_TTL_MS } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AssetSigner from "../assets/AssetSigner.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as KnownWorkspaces from "./KnownWorkspaces.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import {
  WORKSPACE_UPLOAD_ROUTE_PREFIX,
  issueWorkspaceUploadUrl,
  storeWorkspaceUpload,
  validateWorkspaceUploadToken,
  consumeWorkspaceUploadToken,
  type WorkspaceUploadClaims,
} from "./WorkspaceUpload.ts";

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
  Layer.provideMerge(AssetSigner.layer.pipe(Layer.provide(ServerSecretStore.layer))),
  Layer.provideMerge(ServerSecretStore.layer),
  Layer.provideMerge(
    ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-workspace-upload-test-" }),
  ),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const makeTempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-workspace-upload-" });
});

const claimsFor = (
  cwd: string,
  relativePath: string,
  sizeBytes: number,
  overwrite: boolean,
): WorkspaceUploadClaims => ({
  version: 1,
  kind: "workspace-upload",
  cwd,
  relativePath,
  sizeBytes,
  overwrite,
  expiresAt: Number.MAX_SAFE_INTEGER,
  nonce: "test-nonce",
});

const BYTES = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28, 0x41, 0x00]);

const tokenOf = (relativeUrl: string) =>
  relativeUrl.slice(`${WORKSPACE_UPLOAD_ROUTE_PREFIX}/`.length);

const isPartFile = (name: string) => name.startsWith(".") && name.endsWith(".t3-upload");

it.layer(layerTest)("WorkspaceUpload", (it) => {
  describe("issueWorkspaceUploadUrl", () => {
    it.effect("signs a URL for a new path", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const result = yield* issueWorkspaceUploadUrl({
          cwd,
          relativePath: "assets/new/logo.bin",
          sizeBytes: 8,
          overwrite: false,
        });

        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.relativePath).toBe("assets/new/logo.bin");
        expect(result.relativeUrl.startsWith(`${WORKSPACE_UPLOAD_ROUTE_PREFIX}/`)).toBe(true);
        expect(result.expiresAt).toBe(PROJECT_UPLOAD_URL_TTL_MS);
      }),
    );

    it.effect("reports an existing file unless overwrite is set", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.writeFileString(path.join(cwd, "a.txt"), "old");

        const kept = yield* issueWorkspaceUploadUrl({
          cwd,
          relativePath: "a.txt",
          sizeBytes: 3,
          overwrite: false,
        });
        expect(kept).toEqual({ status: "exists", relativePath: "a.txt" });

        const replaced = yield* issueWorkspaceUploadUrl({
          cwd,
          relativePath: "a.txt",
          sizeBytes: 3,
          overwrite: true,
        });
        expect(replaced.status).toBe("ready");
        expect(yield* fileSystem.readFileString(path.join(cwd, "a.txt"))).toBe("old");
      }),
    );

    it.effect("refuses a folder at the target, even with overwrite", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, "docs"));

        for (const overwrite of [false, true]) {
          const error = yield* issueWorkspaceUploadUrl({
            cwd,
            relativePath: "docs",
            sizeBytes: 1,
            overwrite,
          }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspacePathNotFileError);
        }
      }),
    );

    it.effect("refuses paths outside the root, in git's folders, or in unknown workspaces", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.makeDirectory(path.join(cwd, ".git"));

        for (const relativePath of ["../escape", path.join(outsideDir, "abs")]) {
          const error = yield* issueWorkspaceUploadUrl({
            cwd,
            relativePath,
            sizeBytes: 1,
            overwrite: false,
          }).pipe(Effect.flip);
          expect(error).toBeInstanceOf(WorkspacePaths.WorkspacePathOutsideRootError);
        }
        const gitError = yield* issueWorkspaceUploadUrl({
          cwd,
          relativePath: ".git/x",
          sizeBytes: 1,
          overwrite: false,
        }).pipe(Effect.flip);
        expect(gitError).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);

        const unknown = yield* fileSystem.makeTempDirectoryScoped({
          prefix: UNKNOWN_WORKSPACE_PREFIX,
        });
        const unknownError = yield* issueWorkspaceUploadUrl({
          cwd: unknown,
          relativePath: "new.bin",
          sizeBytes: 1,
          overwrite: false,
        }).pipe(Effect.flip);
        expect(unknownError).toBeInstanceOf(KnownWorkspaces.UnknownWorkspaceError);

        expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
        expect(yield* fileSystem.readDirectory(path.join(cwd, ".git"))).toEqual([]);
      }),
    );
  });

  describe("validateWorkspaceUploadToken", () => {
    const issueToken = (cwd: string) =>
      issueWorkspaceUploadUrl({
        cwd,
        relativePath: "up/file.bin",
        sizeBytes: 8,
        overwrite: true,
      }).pipe(
        Effect.map((result) => {
          if (result.status !== "ready") throw new Error("expected a ready result");
          return tokenOf(result.relativeUrl);
        }),
      );

    it.effect("round-trips the issued claims", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const token = yield* issueToken(cwd);

        expect(yield* validateWorkspaceUploadToken(token)).toEqual({
          version: 1,
          kind: "workspace-upload",
          cwd,
          relativePath: "up/file.bin",
          sizeBytes: 8,
          overwrite: true,
          expiresAt: PROJECT_UPLOAD_URL_TTL_MS,
          nonce: expect.any(String),
        });
      }),
    );

    it.effect("accepts each token for one upload only", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const token = yield* issueToken(cwd);
        const other = yield* issueToken(cwd);

        expect(yield* consumeWorkspaceUploadToken(token)).not.toBeNull();
        expect(yield* consumeWorkspaceUploadToken(token)).toBeNull();
        expect(yield* consumeWorkspaceUploadToken(other)).not.toBeNull();
      }),
    );

    it.effect("rejects tampered and malformed tokens", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const token = yield* issueToken(cwd);
        const [payload = "", signature = ""] = token.split(".");
        // The last base64 character can hold padding bits that decoders ignore, so change the first.
        const flipFirst = (value: string) =>
          `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;

        expect(
          yield* validateWorkspaceUploadToken(`${flipFirst(payload)}.${signature}`),
        ).toBeNull();
        expect(
          yield* validateWorkspaceUploadToken(`${payload}.${flipFirst(signature)}`),
        ).toBeNull();
        expect(yield* validateWorkspaceUploadToken(`${token}.extra`)).toBeNull();
        expect(yield* validateWorkspaceUploadToken(payload)).toBeNull();
        expect(yield* validateWorkspaceUploadToken("garbage")).toBeNull();
      }),
    );

    it.effect("rejects an expired token", () =>
      Effect.gen(function* () {
        const cwd = yield* makeTempDir;
        const token = yield* issueToken(cwd);

        yield* TestClock.adjust(PROJECT_UPLOAD_URL_TTL_MS - 1);
        expect(yield* validateWorkspaceUploadToken(token)).not.toBeNull();
        yield* TestClock.adjust(1);
        expect(yield* validateWorkspaceUploadToken(token)).toBeNull();
      }),
    );
  });

  describe("storeWorkspaceUpload", () => {
    it.effect("writes binary bytes into a new nested folder and lists the file", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
        const cwd = yield* makeTempDir;
        yield* workspaceEntries.list({ cwd });

        const result = yield* storeWorkspaceUpload(
          claimsFor(cwd, "a/b/c/blob.bin", BYTES.byteLength, false),
          Stream.make(BYTES.slice(0, 3), BYTES.slice(3)),
        );

        expect(result).toEqual({
          status: "written",
          relativePath: "a/b/c/blob.bin",
          replaced: false,
        });
        const stored = yield* fileSystem.readFile(path.join(cwd, "a/b/c/blob.bin"));
        expect(Array.from(stored)).toEqual(Array.from(BYTES));
        expect(yield* fileSystem.readDirectory(path.join(cwd, "a/b/c"))).toEqual(["blob.bin"]);
        const listed = yield* workspaceEntries.list({ cwd });
        expect(listed.entries).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: "a/b/c/blob.bin" })]),
        );
      }),
    );

    it.effect("keeps an existing file when overwrite is off", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.writeFileString(path.join(cwd, "keep.bin"), "old");

        const result = yield* storeWorkspaceUpload(
          claimsFor(cwd, "keep.bin", BYTES.byteLength, false),
          Stream.make(BYTES),
        );

        expect(result).toEqual({ status: "exists", relativePath: "keep.bin" });
        expect(yield* fileSystem.readFileString(path.join(cwd, "keep.bin"))).toBe("old");
        expect(yield* fileSystem.readDirectory(cwd)).toEqual(["keep.bin"]);
      }),
    );

    it.effect("replaces an existing file when overwrite is on", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        yield* fileSystem.writeFileString(path.join(cwd, "swap.bin"), "old");
        yield* fileSystem.chmod(path.join(cwd, "swap.bin"), 0o750);

        const result = yield* storeWorkspaceUpload(
          claimsFor(cwd, "swap.bin", BYTES.byteLength, true),
          Stream.make(BYTES),
        );

        expect(result).toEqual({ status: "written", relativePath: "swap.bin", replaced: true });
        if (!(yield* HostProcess.isWindows)) {
          expect((yield* fileSystem.stat(path.join(cwd, "swap.bin"))).mode & 0o777).toBe(0o750);
        }
        expect(Array.from(yield* fileSystem.readFile(path.join(cwd, "swap.bin")))).toEqual(
          Array.from(BYTES),
        );
        expect((yield* fileSystem.readDirectory(cwd)).filter(isPartFile)).toEqual([]);
        expect(yield* fileSystem.readDirectory(cwd)).toEqual(["swap.bin"]);
      }),
    );

    it.effect("rejects a body that is shorter or longer than the claimed size", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;

        const tooLong = new Uint8Array([...BYTES, 1]);
        const bodies = [
          Stream.make(BYTES.slice(0, 4)),
          Stream.make(tooLong),
          // Reading stops at the limit, so the rest of an endless body is never pulled.
          Stream.concat(Stream.make(tooLong), Stream.die("read past the size limit")),
        ];
        for (const body of bodies) {
          for (const overwrite of [false, true]) {
            const result = yield* storeWorkspaceUpload(
              claimsFor(cwd, "dir/sized.bin", BYTES.byteLength, overwrite),
              body,
            );
            expect(result).toMatchObject({ status: "rejected", httpStatus: 400 });
            expect(yield* fileSystem.exists(path.join(cwd, "dir/sized.bin"))).toBe(false);
            expect(yield* fileSystem.readDirectory(path.join(cwd, "dir"))).toEqual([]);
          }
        }
      }),
    );

    it.effect.skipIf(!symlinksSupported)("refuses a symlink that leaves the workspace", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const cwd = yield* makeTempDir;
        const outsideDir = yield* makeTempDir;
        yield* fileSystem.symlink(outsideDir, path.join(cwd, "out"));

        const error = yield* storeWorkspaceUpload(
          claimsFor(cwd, "out/stolen.bin", BYTES.byteLength, true),
          Stream.make(BYTES),
        ).pipe(Effect.flip);

        expect(error).toBeInstanceOf(WorkspaceFileSystem.WorkspaceFilePathEscapeError);
        expect(yield* fileSystem.readDirectory(outsideDir)).toEqual([]);
      }),
    );
  });
});
