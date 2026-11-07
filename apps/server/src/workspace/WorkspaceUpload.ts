// @effect-diagnostics nodeBuiltinImport:off -- exclusive create, hard links and no-follow opens are missing from Effect's FileSystem.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";

import {
  PROJECT_UPLOAD_URL_TTL_MS,
  type ProjectCreateUploadUrlInput,
  type ProjectCreateUploadUrlResult,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as AssetSigner from "../assets/AssetSigner.ts";
import { base64UrlDecodeUtf8, base64UrlEncode } from "../auth/utils.ts";
import { requestUrl } from "../requestUrl.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";

export const WORKSPACE_UPLOAD_ROUTE_PREFIX = "/api/workspace/upload";

const WorkspaceUploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("workspace-upload"),
  cwd: Schema.String,
  relativePath: Schema.String,
  sizeBytes: Schema.Number,
  overwrite: Schema.Boolean,
  expiresAt: Schema.Number,
  /** Makes each URL single-use, so a leaked URL cannot write the file again. */
  nonce: Schema.String,
});
export type WorkspaceUploadClaims = typeof WorkspaceUploadClaims.Type;

const claimsJson = Schema.fromJsonString(WorkspaceUploadClaims);
const decodeClaimsJson = Schema.decodeUnknownOption(claimsJson);
const encodeClaims = Schema.encodeSync(claimsJson);

const decodeClaims = (encodedPayload: string): WorkspaceUploadClaims | null => {
  try {
    return Option.getOrNull(decodeClaimsJson(base64UrlDecodeUtf8(encodedPayload)));
  } catch {
    return null;
  }
};

const lstatOrNull = (target: string) =>
  NodeFSP.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

const operationError = (
  claims: Pick<WorkspaceUploadClaims, "cwd" | "relativePath">,
  resolvedPath: string,
  cause: unknown,
) =>
  new WorkspaceFileSystem.WorkspaceFileSystemOperationError({
    workspaceRoot: claims.cwd,
    relativePath: claims.relativePath,
    resolvedPath,
    operationPath: resolvedPath,
    operation: "write-file",
    cause,
  });

/** Checks the target with writeFile's rules, then signs a short-lived URL that may write it. */
export const issueWorkspaceUploadUrl = Effect.fn("WorkspaceUpload.issueUrl")(function* (
  input: ProjectCreateUploadUrlInput,
) {
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const target = yield* workspaceFileSystem.resolveWritePath(input);
  const existing = yield* Effect.tryPromise({
    try: () => lstatOrNull(target.realTargetPath),
    catch: (cause) => operationError(input, target.realTargetPath, cause),
  });
  if (existing?.isDirectory()) {
    return yield* new WorkspaceFileSystem.WorkspacePathNotFileError({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.realTargetPath,
    });
  }
  if (existing && !input.overwrite) {
    return {
      status: "exists",
      relativePath: target.relativePath,
    } satisfies ProjectCreateUploadUrlResult;
  }

  const expiresAt = (yield* Clock.currentTimeMillis) + PROJECT_UPLOAD_URL_TTL_MS;
  const encodedPayload = base64UrlEncode(
    encodeClaims({
      version: 1,
      kind: "workspace-upload",
      cwd: input.cwd,
      relativePath: target.relativePath,
      sizeBytes: input.sizeBytes,
      overwrite: input.overwrite,
      expiresAt,
      nonce: yield* (yield* SecureRandom.SecureRandom).uuidV4(),
    }),
  );
  const signer = yield* AssetSigner.AssetSigner;
  const signature = yield* signer
    .sign(encodedPayload)
    .pipe(Effect.mapError((cause) => operationError(input, target.realTargetPath, cause)));
  return {
    status: "ready",
    relativePath: target.relativePath,
    relativeUrl: `${WORKSPACE_UPLOAD_ROUTE_PREFIX}/${encodedPayload}.${signature}`,
    expiresAt,
  } satisfies ProjectCreateUploadUrlResult;
});

export const validateWorkspaceUploadToken = Effect.fn("WorkspaceUpload.validateToken")(function* (
  token: string,
) {
  const [encodedPayload, signature, unexpectedSegment] = token.split(".");
  if (!encodedPayload || !signature || unexpectedSegment) return null;
  const signer = yield* AssetSigner.AssetSigner;
  const verified = yield* signer
    .verify(encodedPayload, signature)
    .pipe(Effect.orElseSucceed(() => false));
  if (!verified) return null;
  const claims = decodeClaims(encodedPayload);
  if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;
  return claims;
});

// Used nonces are kept until their token expires; a restart forgets them, as it does other uploads.
const usedUploadNonces = new Map<string, number>();

/** Validates a token and marks it used; a second use returns null. */
export const consumeWorkspaceUploadToken = Effect.fn("WorkspaceUpload.consumeToken")(function* (
  token: string,
) {
  const claims = yield* validateWorkspaceUploadToken(token);
  if (!claims) return null;
  const nowMs = yield* Clock.currentTimeMillis;
  for (const [nonce, expiresAt] of usedUploadNonces) {
    if (expiresAt <= nowMs) usedUploadNonces.delete(nonce);
  }
  if (usedUploadNonces.has(claims.nonce)) return null;
  usedUploadNonces.set(claims.nonce, claims.expiresAt);
  return claims;
});

export type StoreWorkspaceUploadResult =
  | { readonly status: "written"; readonly relativePath: string; readonly replaced: boolean }
  | { readonly status: "exists"; readonly relativePath: string }
  | { readonly status: "rejected"; readonly httpStatus: number; readonly detail: string };

// Filesystems without hard links fall back to a checked rename.
const NO_HARD_LINK_CODES = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ENOSYS"]);

/**
 * Streams the body into a hidden part file beside the target, then commits it. Without
 * overwrite the commit is a hard link, so an existing file is never replaced.
 */
export const storeWorkspaceUpload = Effect.fn("WorkspaceUpload.store")(function* <E>(
  claims: WorkspaceUploadClaims,
  body: Stream.Stream<Uint8Array, E>,
) {
  const workspaceFileSystem = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;
  const path = yield* Path.Path;
  // The workspace may have changed since the URL was issued, so check the target again.
  const target = yield* workspaceFileSystem.resolveWritePath(claims);
  const realTargetPath = target.realTargetPath;
  const partId = yield* (yield* SecureRandom.SecureRandom).uuidV4();
  const partPath = path.join(
    path.dirname(realTargetPath),
    `.${path.basename(realTargetPath)}.${partId}.t3-upload`,
  );
  const fail = (cause: unknown) => operationError(claims, realTargetPath, cause);

  const removePart = Effect.promise(() => NodeFSP.unlink(partPath).catch(() => undefined));

  yield* Effect.tryPromise({
    try: () => NodeFSP.mkdir(path.dirname(realTargetPath), { recursive: true }),
    catch: fail,
  });

  const receivedBytes = yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () =>
        NodeFSP.open(
          partPath,
          NodeFS.constants.O_WRONLY |
            NodeFS.constants.O_CREAT |
            NodeFS.constants.O_EXCL |
            (NodeFS.constants.O_NOFOLLOW ?? 0),
          0o666,
        ),
      catch: fail,
    }),
    (handle) => {
      let received = 0;
      return Stream.runForEach(body, (chunk) => {
        received += chunk.byteLength;
        if (received > claims.sizeBytes) return Effect.void;
        return Effect.tryPromise({ try: () => handle.write(chunk), catch: fail });
      }).pipe(Effect.map(() => received));
    },
    (handle) => Effect.promise(() => handle.close()),
  ).pipe(Effect.onError(() => removePart));

  if (receivedBytes !== claims.sizeBytes) {
    yield* removePart;
    return {
      status: "rejected",
      httpStatus: 400,
      detail: `Body was ${receivedBytes} bytes, expected ${claims.sizeBytes}.`,
    } satisfies StoreWorkspaceUploadResult;
  }

  const committed = yield* Effect.tryPromise({
    try: async (): Promise<"written" | "replaced" | "exists"> => {
      if (claims.overwrite) {
        const existing = await lstatOrNull(realTargetPath);
        if (existing?.isDirectory()) {
          throw Object.assign(new Error("A folder already has this name."), { code: "EISDIR" });
        }
        await NodeFSP.rename(partPath, realTargetPath);
        return existing ? "replaced" : "written";
      }
      try {
        await NodeFSP.link(partPath, realTargetPath);
        return "written";
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? "";
        if (code === "EEXIST") return "exists";
        if (!NO_HARD_LINK_CODES.has(code)) throw error;
        if (await lstatOrNull(realTargetPath)) return "exists";
        await NodeFSP.rename(partPath, realTargetPath);
        return "written";
      }
    },
    catch: fail,
  }).pipe(Effect.ensuring(removePart));

  if (committed === "exists") {
    return {
      status: "exists",
      relativePath: target.relativePath,
    } satisfies StoreWorkspaceUploadResult;
  }
  if (committed === "written") yield* workspaceEntries.refresh(claims.cwd);
  return {
    status: "written",
    relativePath: target.relativePath,
    replaced: committed === "replaced",
  } satisfies StoreWorkspaceUploadResult;
});

const text = (body: string, status: number) => HttpServerResponse.text(body, { status });

export const layerWorkspaceUploadRoute = HttpRouter.add(
  "POST",
  `${WORKSPACE_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = requestUrl(request);
    if (Option.isNone(url)) return text("Bad Request", 400);
    const token = url.value.pathname.slice(`${WORKSPACE_UPLOAD_ROUTE_PREFIX}/`.length);
    const claims = token ? yield* consumeWorkspaceUploadToken(token) : null;
    if (!claims) return text("Not Found", 404);

    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && Number(contentLength) !== claims.sizeBytes) {
      return text("Content-Length must match the upload size.", 400);
    }

    // Keep the request stream in the route scope until the response is sent.
    const bodyPull = yield* Stream.toPull(request.stream);
    const stored = yield* storeWorkspaceUpload(
      claims,
      Stream.fromPull(Effect.succeed(bodyPull)),
    ).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          status: "rejected",
          httpStatus: 422,
          detail: error.message,
        } satisfies StoreWorkspaceUploadResult),
      ),
    );
    switch (stored.status) {
      case "written":
        return HttpServerResponse.empty({ status: 204 });
      case "exists":
        return text(`'${stored.relativePath}' already exists.`, 409);
      case "rejected":
        return text(stored.detail, stored.httpStatus);
    }
  }),
);
