import { describe, expect, it } from "@effect/vitest";

import { createUploadProgressStore, type WorkspaceUploadProgress } from "./uploadProgressStore";

const progress = (bytesDone: number): WorkspaceUploadProgress => ({
  fileCount: 1,
  filesDone: 0,
  bytesTotal: 100,
  bytesDone,
  currentPath: "a.txt",
});

describe("createUploadProgressStore", () => {
  it("publishes the start and end at once and coalesces updates to one per frame", () => {
    const frames: Array<() => void> = [];
    const store = createUploadProgressStore((run) => {
      frames.push(run);
      return () => {};
    });
    let notified = 0;
    store.subscribe(() => notified++);

    store.set(progress(0));
    expect(notified).toBe(1);

    store.set(progress(10));
    store.set(progress(20));
    store.set(progress(30));
    expect(notified).toBe(1);
    expect(frames).toHaveLength(1);

    frames[0]!();
    expect(notified).toBe(2);
    expect(store.get()?.bytesDone).toBe(30);

    store.set(progress(40));
    store.set(null);
    expect(notified).toBe(3);
    expect(store.get()).toBeNull();
    expect(store.isActive()).toBe(false);
  });
});
