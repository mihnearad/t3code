import type { FileTreeDropTarget } from "@pierre/trees";

export interface FileTreeMove {
  /** Workspace-relative paths, without the tree's trailing slash on folders. */
  readonly fromPath: string;
  readonly toPath: string;
  /** Canonical tree paths: folders end in `/`. */
  readonly fromTreePath: string;
  readonly toTreePath: string;
}

const trimSlash = (path: string) => (path.endsWith("/") ? path.slice(0, -1) : path);

/** Where each dragged tree row lands when dropped on a folder or the root. */
export function planFileTreeMoves(
  draggedPaths: readonly string[],
  target: Pick<FileTreeDropTarget, "kind" | "directoryPath">,
): FileTreeMove[] {
  const folder =
    target.kind === "root" || target.directoryPath == null ? "" : trimSlash(target.directoryPath);
  const moves: FileTreeMove[] = [];
  const draggedFolders = draggedPaths.filter((path) => path.endsWith("/"));
  for (const fromTreePath of draggedPaths) {
    // A row inside a dragged folder moves with that folder.
    if (
      draggedFolders.some((folder) => folder !== fromTreePath && fromTreePath.startsWith(folder))
    ) {
      continue;
    }
    const fromPath = trimSlash(fromTreePath);
    const name = fromPath.slice(fromPath.lastIndexOf("/") + 1);
    const toPath = folder ? `${folder}/${name}` : name;
    if (toPath === fromPath) continue;
    const suffix = fromTreePath.endsWith("/") ? "/" : "";
    moves.push({ fromPath, toPath, fromTreePath, toTreePath: `${toPath}${suffix}` });
  }
  return moves;
}
