import { FilePlusIcon, FolderPlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

import { validateWorkspaceEntryName, type WorkspaceEntryKind } from "./workspaceEntryName";

export function NewWorkspaceEntryButton(props: { kind: WorkspaceEntryKind; onClick: () => void }) {
  const Icon = props.kind === "folder" ? FolderPlusIcon : FilePlusIcon;
  const label = props.kind === "folder" ? "New folder" : "New file";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            onClick={props.onClick}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

/** Inline name field shown above the file tree while a new file or folder is being named. */
export function NewWorkspaceEntryRow(props: {
  kind: WorkspaceEntryKind;
  parentPath: string;
  /** Resolves to an error message, or null once the entry exists. */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const Icon = props.kind === "folder" ? FolderPlusIcon : FilePlusIcon;
  const label = props.kind === "folder" ? "New folder name" : "New file name";

  const submit = async () => {
    if (busy) return;
    const validation = validateWorkspaceEntryName(value);
    if (!validation.ok) {
      setError(validation.reason);
      return;
    }
    setBusy(true);
    const failure = await props.onSubmit(validation.name);
    setBusy(false);
    setError(failure);
  };

  return (
    <div className="shrink-0 border-b border-border/60 px-2 py-1.5" data-new-workspace-entry>
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
          {props.parentPath ? `${props.parentPath}/` : ""}
        </span>
        <Input
          size="compact"
          font="mono"
          className="min-w-24 flex-1"
          aria-label={label}
          aria-invalid={error !== null}
          placeholder={props.kind === "folder" ? "folder-name" : "file-name.ext"}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              props.onCancel();
            }
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="pt-1 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
