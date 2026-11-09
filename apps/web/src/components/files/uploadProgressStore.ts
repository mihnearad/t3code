export interface WorkspaceUploadProgress {
  readonly fileCount: number;
  readonly filesDone: number;
  readonly bytesTotal: number;
  readonly bytesDone: number;
  readonly currentPath: string | null;
}

type FrameScheduler = (run: () => void) => () => void;

const animationFrameScheduler: FrameScheduler = (run) => {
  const handle = requestAnimationFrame(run);
  return () => cancelAnimationFrame(handle);
};

/**
 * Holds upload progress outside React so progress events re-render only the status row.
 * Updates are published at most once per frame; start and end publish at once.
 */
export function createUploadProgressStore(schedule: FrameScheduler = animationFrameScheduler) {
  let published: WorkspaceUploadProgress | null = null;
  let latest: WorkspaceUploadProgress | null = null;
  let cancelFrame: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = () => {
    cancelFrame?.();
    cancelFrame = null;
    if (published === latest) return;
    published = latest;
    for (const listener of listeners) listener();
  };

  return {
    get: () => published,
    isActive: () => latest !== null,
    set(progress: WorkspaceUploadProgress | null) {
      latest = progress;
      if (progress === null || published === null) {
        publish();
        return;
      }
      cancelFrame ??= schedule(publish);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type UploadProgressStore = ReturnType<typeof createUploadProgressStore>;
