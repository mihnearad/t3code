import { RefreshIcon } from "~/components/ui/refresh-icon";
import type {
  ContextMenuItem as TreeContextMenuItem,
  ContextMenuOpenContext as TreeContextMenuOpenContext,
  FileTreeDropTarget,
} from "@pierre/trees";
import {
  AuthFilesystemWriteScope,
  type EnvironmentId,
  type ProjectEntry,
} from "@t3tools/contracts";
import { FileTree, useFileTree, useFileTreeSearch, useFileTreeSelector } from "@pierre/trees/react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Cause from "effect/Cause";
import { ChevronsDownUp, ChevronsUpDown } from "lucide";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { InputGroup, InputGroupInput } from "~/components/ui/input-group";
import { MorphIcon } from "~/components/MorphIcon";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useComposerHandleContext } from "~/composerHandleContext";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { useWorkspaceMutationRefresh } from "~/hooks/useWorkspaceMutationRefresh";
import { useFileContextMenu, type FileContextMenuAction } from "~/fileContextMenu";
import { readLocalApi } from "~/localApi";
import { T3_PIERRE_ICONS } from "~/pierre-icons";
import { PIERRE_TREE_UNSAFE_CSS, pierreTreeStyle } from "~/pierre-tree-theme";

import { joinHostPath } from "./filePath";
import { createFileTreeDragMentionController } from "./fileTreeDragMention";
import { areAllDirectoriesExpanded, setAllDirectoriesExpanded } from "./fileTreeExpansion";
import { buildFileTreePathUpdates } from "./fileTreePathReconciliation";
import { loadFileAncestors } from "./loadFileAncestors";
import { useDirectoryEntries } from "./useDirectoryEntries";
import { requestConfirmDialog } from "~/confirmDialog";
import { useProjectPathSearch } from "~/state/queries";
import { useEnvironmentScope } from "~/state/session";
import { NewWorkspaceEntryButton, NewWorkspaceEntryRow } from "./NewWorkspaceEntryRow";
import { type FileTreeMove, planFileTreeMoves } from "./fileTreeMove";
import {
  fileDropFolder,
  isFinderFileDrag,
  isOverFileTreeRow,
  setRootDropHighlight,
} from "./fileTreeRootDrop";
import { captureDroppedEntries, collectDroppedFiles, type DroppedEntry } from "./droppedFiles";
import { useWorkspaceUpload } from "./useWorkspaceUpload";
import { WorkspaceUploadStatus } from "./WorkspaceUploadStatus";
import { useWorkspaceEntryActions } from "./useWorkspaceEntryActions";
import {
  joinWorkspacePath,
  parentWorkspacePath,
  remapMovedPath,
  type WorkspaceEntryKind,
} from "./workspaceEntryName";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  selectedPath: string | null;
  selectedPathRevealId: number;
  onOpenFile: (relativePath: string) => void;
  /** Host-folder entries use absolute paths. Avoid full traversal: disable expand-all and search only
   * loaded folders. */
  hostFolder?: boolean;
  onRefreshSelectedFile?: () => void;
  workspaceMutationId: string | null;
}

function treePath(entry: ProjectEntry): string {
  return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function RefreshFilesButton(props: { isPending: boolean; onRefresh: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh workspace files"
            onClick={props.onRefresh}
          />
        }
      >
        <RefreshIcon refreshing={props.isPending} />
      </TooltipTrigger>
      <TooltipPopup>{props.isPending ? "Refreshing…" : "Refresh files"}</TooltipPopup>
    </Tooltip>
  );
}

function FileSearchField(props: {
  ariaLabel: string;
  name: string;
  onClose: () => void;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <InputGroup variant="ghost" className="h-7 min-w-0 flex-1">
      <InputGroupInput
        type="search"
        name={props.name}
        size="sm"
        value={props.value}
        aria-label={props.ariaLabel}
        placeholder="Search files"
        data-workspace-focus-default
        spellCheck={false}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          props.onClose();
          event.currentTarget.blur();
        }}
      />
    </InputGroup>
  );
}

function buildTreeEntries(
  directoryEntries: readonly ProjectEntry[],
  searchEntries: readonly ProjectEntry[],
  searchPending: boolean,
  query: string,
) {
  const result = new Map(directoryEntries.map((entry) => [entry.path, entry]));
  if (query.trim() && !searchPending) {
    for (const entry of searchEntries) {
      if (!result.has(entry.path)) result.set(entry.path, entry);
      const segments = entry.path.split("/");
      for (let index = 1; index < segments.length; index++) {
        const path = segments.slice(0, index).join("/");
        if (!result.has(path)) result.set(path, { path, kind: "directory" });
      }
    }
  }
  const entries = [...result.values()];
  const entryKinds: ReadonlyMap<string, ProjectEntry["kind"]> = new Map(
    entries.map((entry) => [entry.path, entry.kind] as const),
  );
  const treePaths = entries.map(treePath);
  const directories = entries.filter((entry) => entry.kind === "directory");
  const directoryPaths = directories.map(treePath);
  // Expanding a folder lists it, and an ignored one such as `node_modules` can hold tens of
  // thousands, so expand all skips ignored folders. They still open by hand.
  const expandableDirectoryPaths = directories.filter((entry) => !entry.ignored).map(treePath);
  return { entries, entryKinds, treePaths, directoryPaths, expandableDirectoryPaths };
}

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  selectedPath,
  selectedPathRevealId,
  onOpenFile,
  onRefreshSelectedFile,
  workspaceMutationId,
  hostFolder = false,
}: FileBrowserPanelProps) {
  const panelPath = (relativePath: string) =>
    hostFolder ? joinHostPath(cwd, relativePath) : relativePath;
  const { resolvedTheme } = useTheme();
  const composerRef = useComposerHandleContext();
  const fileContextMenu = useFileContextMenu(environmentId);
  const {
    entries: directoryEntries,
    load,
    refresh,
    ready,
    error,
    isPending,
    loadingDirectories,
  } = useDirectoryEntries(environmentId, cwd);
  const [query, setQuery] = useState("");
  const [expandAll, setExpandAll] = useState(false);
  // Host folders are not known workspaces, so the server refuses writes there.
  const canCreateEntries =
    useEnvironmentScope(environmentId, AuthFilesystemWriteScope) && !hostFolder;
  // renamePath set: renaming that entry; otherwise creating a new one in parentPath.
  const [newEntry, setNewEntry] = useState<{
    kind: WorkspaceEntryKind;
    parentPath: string;
    renamePath?: string;
  } | null>(null);
  const entryActions = useWorkspaceEntryActions(environmentId, cwd);
  const upload = useWorkspaceUpload(environmentId, cwd);
  const uploadDroppedFiles = async (folderPath: string, captured: DroppedEntry[] | File[]) => {
    const { files, skipped } = await collectDroppedFiles(captured);
    if (files.length === 0 && skipped.length === 0) return;
    await upload.start({
      folderPath,
      files,
      skipped,
      onFoldersChanged: () => {
        refresh();
        void load(folderPath, true);
        expandFolder(folderPath);
      },
    });
  };
  // The tree's drop handlers are created before the tree model, so they reach it through this ref.
  const treeModelRef = useRef<ReturnType<typeof useFileTree>["model"] | null>(null);
  const expandFolder = (folderPath: string) => {
    const folder = folderPath ? treeModelRef.current?.getItem(`${folderPath}/`) : null;
    if (folder && "expand" in folder) folder.expand();
  };
  const finishMove = async (fromPath: string, toPath: string) => {
    await Promise.all(
      [...new Set([parentWorkspacePath(fromPath), parentWorkspacePath(toPath)])].map((folder) =>
        load(folder, true),
      ),
    );
    expandFolder(parentWorkspacePath(toPath));
    const moved = selectedPath ? remapMovedPath(selectedPath, fromPath, toPath) : null;
    if (moved) onOpenFile(panelPath(moved));
  };
  const deleteEntry = async (relativePath: string, isDirectory: boolean) => {
    const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    const confirmed =
      (await requestConfirmDialog(
        `Delete "${name}"?\n${isDirectory ? "The folder and everything in it will be" : "The file will be"} deleted permanently from ${relativePath}. This cannot be undone.`,
        { variant: "destructive" },
      )) ?? false;
    if (!confirmed) return;
    const result = await entryActions.remove(relativePath);
    if (!result.ok) {
      if (!("interrupted" in result)) {
        toastManager.add({
          type: "error",
          title: `Unable to delete ${name}`,
          description: result.message,
        });
      }
      return;
    }
    await load(parentWorkspacePath(relativePath), true);
    toastManager.add({ type: "success", title: `Deleted ${name}` });
  };
  const canDropEntries = useStableCallback(() => canCreateEntries);
  const runTreeMoves = async (moves: readonly FileTreeMove[]) => {
    for (const move of moves) {
      const result = await entryActions.move(move.fromPath, move.toPath);
      if (result.ok) await finishMove(move.fromPath, result.relativePath);
      else if (!("interrupted" in result)) {
        toastManager.add({
          type: "error",
          title: `Unable to move ${move.fromPath}`,
          description: result.message,
        });
      }
    }
  };
  const handleTreeDrop = useStableCallback(
    (draggedPaths: readonly string[], target: FileTreeDropTarget) => {
      const moves = planFileTreeMoves(draggedPaths, target);
      // Pierre has already moved its rows. Put them back so the tree only shows what the server did.
      for (const move of moves.toReversed()) {
        treeModelRef.current?.move(move.toTreePath, move.fromTreePath);
      }
      void runTreeMoves(moves);
    },
  );
  const submitNewEntry = async (
    entry: { kind: WorkspaceEntryKind; parentPath: string; renamePath?: string },
    name: string,
  ) => {
    const toPath = joinWorkspacePath(entry.parentPath, name);
    const result = entry.renamePath
      ? await entryActions.move(entry.renamePath, toPath)
      : await entryActions.create({ kind: entry.kind, parentPath: entry.parentPath, name });
    if (!result.ok) return "interrupted" in result ? null : result.message;
    setNewEntry(null);
    if (entry.renamePath) {
      await finishMove(entry.renamePath, result.relativePath);
      return null;
    }
    await load(entry.parentPath, true);
    if (entry.kind === "file") onOpenFile(panelPath(result.relativePath));
    else expandFolder(entry.parentPath);
    return null;
  };
  const pathSearch = useProjectPathSearch(
    { environmentId, cwd: hostFolder ? null : cwd, query: query.slice(0, 256) },
    200,
  );
  const { entries, entryKinds, treePaths, directoryPaths, expandableDirectoryPaths } =
    buildTreeEntries(directoryEntries, pathSearch.entries, pathSearch.isPending, query);
  const entryKindsRef = useRef(entryKinds);
  const previousTreePathsRef = useRef<readonly string[] | null>(null);
  const syncingSelectionRef = useRef(false);
  const treeSelectionPathRef = useRef<string | null>(null);
  const handledRevealRef = useRef<{ path: string; revealId: number } | null>(null);

  // Shadow-DOM row rects are unreliable; capture the composed contextmenu event's viewport position.
  const contextMenuPointerRef = useRef<{ x: number; y: number; at: number } | null>(null);

  const showEntryContextMenu = useStableCallback(
    (item: TreeContextMenuItem, context: TreeContextMenuOpenContext) => {
      const api = readLocalApi();
      if (!api) {
        context.close();
        return;
      }
      const relativePath = item.path.replace(/\/$/, "");
      const mention = serializeComposerFileLink(panelPath(relativePath));
      const pointer = contextMenuPointerRef.current;
      const pointerIsFresh = pointer !== null && performance.now() - pointer.at < 1000;
      const anchorRect = context.anchorElement.getBoundingClientRect();
      const position = pointerIsFresh
        ? { x: pointer.x, y: pointer.y }
        : { x: anchorRect.left, y: anchorRect.bottom };
      const fileTarget = { environmentId, filePath: relativePath, workspaceRoot: cwd };
      const fileMenuItems = fileContextMenu.buildItems(fileTarget);
      // The app menu owns focus; the tree's outside-click handler would dismiss it before click.
      context.close({ restoreFocus: !pointerIsFresh });
      void settlePromise(async () => {
        const clicked = await api.contextMenu.show(
          [
            ...fileMenuItems,
            { id: "copy-mention", label: "Copy mention" },
            { id: "add-to-chat", label: "Add to chat" },
            ...(canCreateEntries
              ? [
                  { id: "new-file", label: "New file…", separatorBefore: true },
                  { id: "new-folder", label: "New folder…" },
                  { id: "rename", label: "Rename…" },
                  { id: "delete", label: "Delete…", destructive: true },
                ]
              : []),
          ],
          position,
        );
        if (clicked === null) return;
        const isDirectory = item.path.endsWith("/");
        if (clicked === "new-file" || clicked === "new-folder") {
          setNewEntry({
            kind: clicked === "new-folder" ? "folder" : "file",
            parentPath: isDirectory ? relativePath : parentWorkspacePath(relativePath),
          });
          return;
        }
        if (clicked === "delete") {
          await deleteEntry(relativePath, isDirectory);
          return;
        }
        if (clicked === "rename") {
          setNewEntry({
            kind: isDirectory ? "folder" : "file",
            parentPath: parentWorkspacePath(relativePath),
            renamePath: relativePath,
          });
          return;
        }
        // Open-with submenu ids are absent from the top-level item list.
        const isFileMenuAction =
          fileMenuItems.some((entry) => entry.id === clicked) || clicked.startsWith("editor:");
        if (isFileMenuAction) {
          await fileContextMenu.activate(clicked as FileContextMenuAction, fileTarget);
          return;
        }
        if (clicked === "copy-mention") {
          try {
            await writeTextToClipboard(mention);
            toastManager.add({
              type: "success",
              title: "Mention copied",
              description: relativePath,
            });
          } catch (error) {
            toastManager.add({
              type: "error",
              title: "Failed to copy mention",
              description: error instanceof Error ? error.message : "An error occurred.",
            });
          }
          return;
        }
        if (clicked === "add-to-chat") {
          const composer = composerRef?.current;
          if (!composer) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "Open a chat for this project and try again.",
            });
            return;
          }
          const inserted = composer.insertTextAtEnd(`${mention} `, { ensureLeadingBoundary: true });
          if (!inserted) {
            toastManager.add({
              type: "error",
              title: "Unable to add to chat",
              description: "The chat isn't ready to accept input right now.",
            });
          }
        }
      }).then((result) => {
        if (!AsyncResult.isSuccess(result)) throw Cause.squash(result.cause);
      });
    },
  );

  const loadingDirectoriesRef = useRef(loadingDirectories);
  const dragMention = createFileTreeDragMentionController(
    hostFolder ? { mentionPath: (path: string) => joinHostPath(cwd, path) } : {},
  );
  const isRootDrop = (event: { composedPath(): ReadonlyArray<unknown> }) =>
    canCreateEntries && dragMention.isDragInProgress() && !isOverFileTreeRow(event);
  const { model } = useFileTree({
    composition: {
      contextMenu: {
        triggerMode: "right-click",
        onOpen: (item, context) => {
          showEntryContextMenu(item, context);
        },
      },
    },
    dragAndDrop: {
      canDrop: () => canDropEntries(),
      onDropComplete: (event) => handleTreeDrop(event.draggedPaths, event.target),
      onDropError: (message) =>
        toastManager.add({ type: "error", title: "Unable to move", description: message }),
    },
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      // Update drag selection even for reveals so subsequent drags cannot use stale paths.
      dragMention.handleSelectionChange(selectedPaths);
      if (syncingSelectionRef.current) return;
      if (dragMention.isDragInProgress()) {
        return;
      }
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (selectedPath && entryKindsRef.current.get(selectedPath) === "file") {
        treeSelectionPathRef.current = selectedPath;
        onOpenFile(panelPath(selectedPath));
      }
    },
    paths: [],
    renderRowDecoration: ({ item, row }) =>
      row.kind === "directory" &&
      row.isExpanded &&
      loadingDirectoriesRef.current.has(item.path.replace(/\/$/, ""))
        ? { icon: "t3-tree-icon-loading", title: "Loading…" }
        : null,
    search: false,
    onSearchChange: (value) => setQuery(value ?? ""),
    unsafeCSS: PIERRE_TREE_UNSAFE_CSS,
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the tree model to drop and create handlers that were built before it
  useEffect(() => {
    treeModelRef.current = model;
  }, [model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- makes the Pierre tree model re-render row decorations when loading directories change
  useEffect(() => {
    if (loadingDirectoriesRef.current === loadingDirectories) return;
    loadingDirectoriesRef.current = loadingDirectories;
    model.setComposition(model.getComposition());
  }, [loadingDirectories, model]);
  const search = useFileTreeSearch(model);
  // Pierre restores the unfiltered tree when a search has no matches.
  const hasNoSearchMatches = search.value.trim().length > 0 && search.matchingPaths.length === 0;
  const allDirectoriesExpanded = useFileTreeSelector(model, (currentModel) =>
    areAllDirectoriesExpanded(currentModel, expandableDirectoryPaths),
  );
  const toggleAllDirectories = () => {
    const expanded = !(expandAll || allDirectoriesExpanded);
    setExpandAll(expanded);
    setAllDirectoriesExpanded(
      model,
      expanded ? expandableDirectoryPaths : directoryPaths,
      expanded,
    );
  };
  const closeSearch = () => {
    setQuery("");
    search.close();
  };
  const expandedPathsRef = useRef(new Set<string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the Pierre tree model to load directories as they are expanded
  useEffect(() => {
    const currentPaths = new Set(directoryPaths);
    for (const path of expandedPathsRef.current) {
      if (!currentPaths.has(path)) expandedPathsRef.current.delete(path);
    }
    const loadExpanded = () => {
      if (model.isSearchOpen()) return;
      for (const path of directoryPaths) {
        const item = model.getItem(path);
        if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
          if (!expandedPathsRef.current.has(path)) {
            expandedPathsRef.current.add(path);
            void load(path.replace(/\/$/, ""));
          }
        } else {
          if (item?.isDirectory() && expandedPathsRef.current.has(path)) setExpandAll(false);
          expandedPathsRef.current.delete(path);
        }
      }
    };
    loadExpanded();
    return model.subscribe(loadExpanded);
  }, [directoryPaths, load, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pushes ignored-file status into the imperative Pierre tree model
  useEffect(() => {
    model.setGitStatus(
      entries
        .filter((entry) => entry.ignored)
        .map((entry) => ({
          path: treePath(entry),
          status: "ignored",
        })),
    );
  }, [entries, model]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the selected file's ancestor directories and aborts on cleanup
  useEffect(() => {
    if (!selectedPath) return;
    const controller = new AbortController();
    void loadFileAncestors(selectedPath, load, { signal: controller.signal });
    return () => {
      controller.abort();
    };
  }, [load, selectedPath]);
  const handleSearchValueChange = (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      search.close();
      return;
    }
    search.setValue(value);
  };
  const handleRefresh = () => {
    refresh();
    if (query.trim()) pathSearch.refresh();
    onRefreshSelectedFile?.();
  };
  useWorkspaceMutationRefresh({
    mutationId: workspaceMutationId,
    refresh: () => {
      refresh();
      if (query.trim()) pathSearch.refresh();
    },
    resourceKey: `files:${environmentId}:${cwd}`,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies tree path changes to the imperative Pierre tree model as a reset or batch update
  useEffect(() => {
    if (!ready) return;
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    const previousTreePaths = previousTreePathsRef.current;
    previousTreePathsRef.current = treePaths;
    if (previousTreePaths === null) {
      model.resetPaths(treePaths);
      return;
    }
    const updates = buildFileTreePathUpdates(previousTreePaths, treePaths);
    if (updates.length > 0) model.batch(updates);
  }, [ready, entryKinds, model, treePaths]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expands every directory in the Pierre tree model while expand-all is on and no search is active
  useEffect(() => {
    if (expandAll && !query.trim())
      setAllDirectoriesExpanded(model, expandableDirectoryPaths, true);
  }, [expandableDirectoryPaths, expandAll, model, query]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals an externally selected path in the Pierre tree model by expanding, selecting and scrolling
  useEffect(() => {
    if (!selectedPath) {
      handledRevealRef.current = null;
      return;
    }
    const selectedKind = entryKinds.get(selectedPath);
    if (selectedKind === undefined) {
      handledRevealRef.current = null;
      return;
    }
    const revealRequest = { path: selectedPath, revealId: selectedPathRevealId };
    const handledReveal = handledRevealRef.current;
    // Refresh rebuilds treePaths; replaying handled reveals would close search and steal focus.
    if (
      handledReveal?.path === revealRequest.path &&
      handledReveal.revealId === revealRequest.revealId
    ) {
      return;
    }
    const selectedTreePath = selectedKind === "directory" ? `${selectedPath}/` : selectedPath;
    const selectedItem = model.getItem(selectedTreePath);
    if (!selectedItem) return;

    // Reveal only external selections; tree selections are visible and re-revealing would close search.
    const selectedInTree = model
      .getSelectedPaths()
      .some((path) => path.replace(/\/$/, "") === selectedPath);
    if (selectedInTree && treeSelectionPathRef.current === selectedPath) {
      treeSelectionPathRef.current = null;
      handledRevealRef.current = revealRequest;
      return;
    }
    treeSelectionPathRef.current = null;
    handledRevealRef.current = revealRequest;

    syncingSelectionRef.current = true;
    setQuery("");
    model.closeSearch();
    for (const path of model.getSelectedPaths()) {
      model.getItem(path)?.deselect();
    }

    // Directory paths include trailing slashes; ancestor lookups must match.
    const segments = selectedPath.split("/");
    let ancestorPath = "";
    for (const segment of segments.slice(0, -1)) {
      ancestorPath = ancestorPath ? `${ancestorPath}/${segment}` : segment;
      const item = model.getItem(`${ancestorPath}/`) ?? model.getItem(ancestorPath);
      if (item && "expand" in item) item.expand();
    }

    if ("expand" in selectedItem) selectedItem.expand();
    selectedItem.select();
    model.scrollToPath(selectedTreePath, {
      focus: true,
      offset: "center",
    });
    queueMicrotask(() => {
      syncingSelectionRef.current = false;
    });
  }, [entryKinds, model, selectedPath, selectedPathRevealId]);

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-background data-root-drop:ring-2 data-root-drop:ring-primary/50 data-root-drop:ring-inset data-drop-label:after:pointer-events-none data-drop-label:after:absolute data-drop-label:after:inset-x-2 data-drop-label:after:bottom-2 data-drop-label:after:truncate data-drop-label:after:rounded-md data-drop-label:after:bg-primary data-drop-label:after:px-2 data-drop-label:after:py-1 data-drop-label:after:text-xs data-drop-label:after:text-primary-foreground data-drop-label:after:content-[attr(data-drop-label)]"
      data-file-browser-panel={`${environmentId}:${cwd}`}
      // Capture runs before the tree's shadow-internal row handler opens the menu.
      onContextMenuCapture={(event) => {
        contextMenuPointerRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp };
      }}
      // Capture dragstart before the tree selects the row so selection sees the drag flag.
      onDragStartCapture={(event) => dragMention.handleDragStart(event.nativeEvent)}
      onDragEnd={() => dragMention.handleDragEnd((path) => model.getItem(path)?.deselect())}
      onDragOver={(event) => {
        if (isFinderFileDrag(event) && canCreateEntries && !upload.progress) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          const folder = fileDropFolder(event.nativeEvent);
          setRootDropHighlight(event.currentTarget, true, `Upload to ${folder || projectName}/`);
          return;
        }
        const rootDrop = isRootDrop(event.nativeEvent);
        setRootDropHighlight(event.currentTarget, rootDrop);
        if (!rootDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        )
          return;
        setRootDropHighlight(event.currentTarget, false);
      }}
      onDrop={(event) => {
        setRootDropHighlight(event.currentTarget, false);
        if (isFinderFileDrag(event)) {
          if (!canCreateEntries || upload.progress) return;
          event.preventDefault();
          void uploadDroppedFiles(
            fileDropFolder(event.nativeEvent),
            captureDroppedEntries(event.dataTransfer),
          );
          return;
        }
        if (!isRootDrop(event.nativeEvent)) return;
        event.preventDefault();
        const moves = planFileTreeMoves(dragMention.draggedPaths(), {
          kind: "root",
          directoryPath: null,
        });
        void runTreeMoves(moves);
      }}
    >
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2 in-data-[preview-panel-mode=inline]:mb-1 in-data-[preview-panel-mode=inline]:h-9 in-data-[preview-panel-mode=inline]:min-h-9 in-data-[preview-panel-mode=inline]:border-b-transparent"
        data-surface-subheader
      >
        <RefreshFilesButton isPending={isPending} onRefresh={handleRefresh} />
        {canCreateEntries ? (
          <>
            <NewWorkspaceEntryButton
              kind="file"
              onClick={() => setNewEntry({ kind: "file", parentPath: "" })}
            />
            <NewWorkspaceEntryButton
              kind="folder"
              onClick={() => setNewEntry({ kind: "folder", parentPath: "" })}
            />
          </>
        ) : null}
        <FileSearchField
          name="project-files-search"
          ariaLabel={`Search ${projectName} files`}
          value={search.value}
          onValueChange={handleSearchValueChange}
          onClose={closeSearch}
        />
        {directoryPaths.length > 0 && !hostFolder ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={
                    expandAll || allDirectoriesExpanded
                      ? "Collapse all folders"
                      : "Expand all folders"
                  }
                  onClick={toggleAllDirectories}
                />
              }
            >
              <MorphIcon
                className="size-3.5"
                icon={allDirectoriesExpanded ? ChevronsDownUp : ChevronsUpDown}
              />
            </TooltipTrigger>
            <TooltipPopup>
              {expandAll || allDirectoriesExpanded ? "Collapse all folders" : "Expand all folders"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      {upload.progress ? (
        <WorkspaceUploadStatus progress={upload.progress} onCancel={upload.cancel} />
      ) : null}
      {newEntry ? (
        <NewWorkspaceEntryRow
          key={`${newEntry.kind}:${newEntry.parentPath}:${newEntry.renamePath ?? ""}`}
          kind={newEntry.kind}
          parentPath={newEntry.parentPath}
          {...(newEntry.renamePath
            ? { currentName: newEntry.renamePath.slice(newEntry.renamePath.lastIndexOf("/") + 1) }
            : {})}
          onSubmit={(name) => submitNewEntry(newEntry, name)}
          onCancel={() => setNewEntry(null)}
        />
      ) : null}
      {error || pathSearch.error ? (
        <button
          type="button"
          onClick={handleRefresh}
          className="p-4 text-left text-xs leading-relaxed text-destructive"
        >
          {error ?? pathSearch.error} Click to retry.
        </button>
      ) : null}
      {query.trim() && pathSearch.truncated && !pathSearch.isPending ? (
        <div className="px-3 py-1 text-xs text-muted-foreground">
          More matches available. Refine your search.
        </div>
      ) : null}
      {(!ready || pathSearch.isPending) && (
        <div
          role="status"
          className={
            entries.length > 0 && !hasNoSearchMatches
              ? "sr-only"
              : "px-3 py-1 text-xs text-muted-foreground"
          }
        >
          Loading files…
        </div>
      )}
      {hasNoSearchMatches ? (
        ready && !isPending && !pathSearch.isPending && !error && !pathSearch.error ? (
          <div role="status" className="px-3 py-4 text-xs text-muted-foreground">
            No matching files.
          </div>
        ) : null
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={pierreTreeStyle(resolvedTheme)}
        />
      )}
    </div>
  );
}
