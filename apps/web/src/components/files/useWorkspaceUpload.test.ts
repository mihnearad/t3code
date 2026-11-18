import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.addToast } }));
vi.mock("~/confirmDialog", () => ({ requestConfirmDialog: mocks.confirm }));
vi.mock("~/state/session", () => ({
  readPreparedConnection: () => ({ httpBaseUrl: "http://env.test/" }),
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: {} }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: vi.fn() }));

import { runUploadBatch } from "./useWorkspaceUpload";

type Reply = number | "network-error";

/** Answers each upload request with the next scripted reply. */
function stubUploads(replies: Reply[]) {
  const urls: string[] = [];
  class TestXmlHttpRequest {
    status = 0;
    responseText = "";
    readonly upload = { addEventListener: () => {} };
    private readonly listeners = new Map<string, () => void>();
    private url = "";
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader() {}
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    }
    abort() {}
    send() {
      urls.push(this.url);
      const reply = replies.shift() ?? 204;
      queueMicrotask(() => {
        if (reply === "network-error") this.listeners.get("error")?.();
        else {
          this.status = reply;
          this.listeners.get("load")?.();
        }
        this.listeners.get("loadend")?.();
      });
    }
  }
  vi.stubGlobal("XMLHttpRequest", TestXmlHttpRequest);
  return urls;
}

function startBatch() {
  let issued = 0;
  const createUploadUrl = vi.fn<Parameters<typeof runUploadBatch>[0]["createUploadUrl"]>(async () =>
    AsyncResult.success({
      status: "ready",
      relativePath: "notes.txt",
      relativeUrl: `/api/workspace/upload/token-${++issued}`,
      expiresAt: 0,
    }),
  );
  const done = runUploadBatch({
    environmentId: EnvironmentId.make("env-1"),
    cwd: "/repo",
    folderPath: "",
    files: [{ relativePath: "notes.txt", file: new File(["hello"], "notes.txt") }],
    skipped: [],
    createUploadUrl,
    setProgress: () => {},
    addAbort: () => () => {},
    isCancelled: () => false,
    onFoldersChanged: () => {},
  });
  return { done, createUploadUrl };
}

describe("runUploadBatch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("retries a dropped connection with a fresh URL", async () => {
    vi.useFakeTimers();
    const urls = stubUploads(["network-error", 503, 204]);
    const { done, createUploadUrl } = startBatch();
    await vi.runAllTimersAsync();
    await done;
    expect(createUploadUrl).toHaveBeenCalledTimes(3);
    expect(new Set(urls).size).toBe(3);
    expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });

  it("offers to replace a file that appeared while it was being sent", async () => {
    stubUploads([409, 204]);
    mocks.confirm.mockResolvedValue(true);
    const { done, createUploadUrl } = startBatch();
    await done;
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(createUploadUrl.mock.calls.map(([call]) => call.input.overwrite)).toEqual([false, true]);
    expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
  });
});
