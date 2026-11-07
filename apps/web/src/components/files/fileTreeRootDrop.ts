/** Pierre only finds drop targets on rows; a drop anywhere else in the panel means the project root. */
export function isOverFileTreeRow(event: { composedPath(): ReadonlyArray<unknown> }): boolean {
  return event.composedPath().some((node) => {
    const element = node as { getAttribute?: (name: string) => string | null };
    return (
      typeof element.getAttribute === "function" && element.getAttribute("data-type") === "item"
    );
  });
}

type AttributeNode = { getAttribute?: (name: string) => string | null };

/**
 * The folder a Finder drop lands in: a folder row itself, the folder holding a file row, or the
 * project root ("") off the rows.
 */
export function fileDropFolder(event: { composedPath(): ReadonlyArray<unknown> }): string {
  for (const node of event.composedPath()) {
    const element = node as AttributeNode;
    if (typeof element.getAttribute !== "function") continue;
    const flattened = element.getAttribute("data-item-flattened-subitem");
    if (flattened?.endsWith("/")) return flattened.slice(0, -1);
    if (element.getAttribute("data-type") !== "item") continue;
    const path = element.getAttribute("data-item-path") ?? "";
    if (element.getAttribute("data-item-type") === "folder") return path.replace(/\/$/, "");
    return (element.getAttribute("data-item-parent-path") ?? "").replace(/\/$/, "");
  }
  return "";
}

export function isFinderFileDrag(event: { dataTransfer: { types: ReadonlyArray<string> } }) {
  return event.dataTransfer.types.includes("Files");
}

/** Toggled on the DOM node, not in React state, so dragging does not re-render the panel. */
export function setRootDropHighlight(element: HTMLElement, active: boolean, label?: string): void {
  if (active) element.dataset.rootDrop = "";
  else delete element.dataset.rootDrop;
  if (active && label) element.dataset.dropLabel = label;
  else delete element.dataset.dropLabel;
}
