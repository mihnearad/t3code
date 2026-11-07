import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";

import { Button } from "~/components/ui/button";

import type { WorkspaceUploadProgress } from "./useWorkspaceUpload";

/** Upload progress shown above the file tree while dropped files are sent to the server. */
export function WorkspaceUploadStatus(props: {
  progress: WorkspaceUploadProgress;
  onCancel: () => void;
}) {
  const { progress } = props;
  const fraction = progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : 0;
  const current = Math.min(progress.filesDone + 1, progress.fileCount);
  return (
    <div role="status" className="shrink-0 border-b border-border/60 px-2 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-medium">
          Uploading {current} of {progress.fileCount}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {progress.currentPath ?? ""}
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
      <div
        className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
        aria-label="Upload progress"
      >
        <div className="h-full bg-primary" style={{ width: `${fraction * 100}%` }} />
      </div>
      <div className="pt-0.5 text-muted-foreground">
        {formatAttachmentSize(progress.bytesDone)} of {formatAttachmentSize(progress.bytesTotal)}
      </div>
    </div>
  );
}
