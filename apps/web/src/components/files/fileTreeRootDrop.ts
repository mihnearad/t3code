/** Pierre only finds drop targets on rows; a drop anywhere else in the panel means the project root. */
export function isOverFileTreeRow(event: { composedPath(): ReadonlyArray<unknown> }): boolean {
  return event.composedPath().some((node) => {
    const element = node as { getAttribute?: (name: string) => string | null };
    return (
      typeof element.getAttribute === "function" && element.getAttribute("data-type") === "item"
    );
  });
}

/** Toggled on the DOM node, not in React state, so dragging does not re-render the panel. */
export function setRootDropHighlight(element: HTMLElement, active: boolean): void {
  if (active) element.dataset.rootDrop = "";
  else delete element.dataset.rootDrop;
}
