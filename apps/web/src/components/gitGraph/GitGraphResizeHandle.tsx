import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

import { cn } from "~/lib/utils";

const KEY_STEP = 24;
const GRAPH_COLUMN_MIN_WIDTH = 360;

/** Caps a side column so the graph column keeps its minimum width. */
export const columnMaxSize =
  (cap: number, min: number) =>
  (target: HTMLElement): number => {
    const surface = target.closest("[data-git-graph-surface]");
    if (!surface) return cap;
    let others = 0;
    for (const column of surface.querySelectorAll<HTMLElement>("[data-git-graph-column]")) {
      if (column !== target) others += column.offsetWidth;
    }
    return Math.max(
      min,
      Math.min(cap, Math.floor(surface.clientWidth - GRAPH_COLUMN_MIN_WIDTH - others)),
    );
  };

/**
 * Resizes `targetRef` along one axis. The live size goes straight to the DOM while dragging;
 * the stored size is written once on release. `growDirection` is the sign of the pointer
 * movement (and of the arrow key) that grows the target.
 */
export function GitGraphResizeHandle(props: {
  orientation: "horizontal" | "vertical";
  targetRef: RefObject<HTMLElement | null>;
  size: number;
  defaultSize: number;
  minSize: number;
  maxSize: (target: HTMLElement) => number;
  /** Static upper bound reported as aria-valuemax. */
  ariaMax?: number;
  growDirection: 1 | -1;
  label: string;
  onSizeChange: (size: number) => void;
  className?: string;
}) {
  const vertical = props.orientation === "vertical";
  const property = vertical ? "width" : "height";
  const measure = (target: HTMLElement) => (vertical ? target.offsetWidth : target.offsetHeight);
  const clamp = (size: number, max: number) =>
    Math.min(max, Math.max(props.minSize, Math.round(size)));

  const dragRef = useRef<{
    pointerId: number;
    start: number;
    startSize: number;
    target: HTMLElement;
    maxSize: number;
  } | null>(null);
  const liveSizeRef = useRef(props.size);
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = props.targetRef.current;
    if (event.button !== 0 || !target) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startSize = measure(target);
    dragRef.current = {
      pointerId: event.pointerId,
      start: vertical ? event.clientX : event.clientY,
      startSize,
      target,
      // Measured once: reading layout on every move would force a reflow after each style write.
      maxSize: props.maxSize(target),
    };
    liveSizeRef.current = startSize;
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const moved = (vertical ? event.clientX : event.clientY) - drag.start;
    liveSizeRef.current = clamp(drag.startSize + props.growDirection * moved, drag.maxSize);
    drag.target.style.setProperty(property, `${liveSizeRef.current}px`);
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (liveSizeRef.current !== drag.startSize) props.onSizeChange(liveSizeRef.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = props.targetRef.current;
    if (!target) return;
    if (event.key === "Home") {
      event.preventDefault();
      props.onSizeChange(props.defaultSize);
      return;
    }
    const towardEnd = vertical ? "ArrowRight" : "ArrowDown";
    const towardStart = vertical ? "ArrowLeft" : "ArrowUp";
    const sign = event.key === towardEnd ? 1 : event.key === towardStart ? -1 : 0;
    if (sign === 0) return;
    event.preventDefault();
    props.onSizeChange(
      clamp(measure(target) + props.growDirection * sign * KEY_STEP, props.maxSize(target)),
    );
  };

  return (
    <div
      role="separator"
      aria-orientation={props.orientation}
      aria-label={props.label}
      aria-valuemin={props.minSize}
      aria-valuenow={props.size}
      {...(props.ariaMax !== undefined ? { "aria-valuemax": props.ariaMax } : {})}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onDoubleClick={() => props.onSizeChange(props.defaultSize)}
      onKeyDown={onKeyDown}
      className={cn(
        "group touch-none select-none outline-none",
        vertical
          ? "absolute inset-y-0 z-10 w-1.5 cursor-col-resize"
          : "flex h-3 shrink-0 cursor-row-resize items-center justify-center rounded-t-xl focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        props.className,
      )}
    >
      {vertical ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-150 group-hover:bg-border group-focus-visible:bg-primary/60 group-active:bg-primary/60"
        />
      ) : (
        <span
          aria-hidden
          className="h-1 w-8 rounded-full bg-border group-hover:bg-muted-foreground/50 group-focus-visible:bg-muted-foreground/50"
        />
      )}
    </div>
  );
}
