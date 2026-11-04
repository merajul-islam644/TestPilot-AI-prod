// VS Code-style sidebar sash: drag to resize, double-click to toggle
// minimize/expand, ‹ › arrows to stretch to the extremes, Arrow keys
// when focused. Self-contained -- measures the frame through the DOM
// so Workbench needs no extra refs. While a drag is live the pointer
// is captured here, so gliding over Monaco or xterm cannot drop events.

import type { KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { SIDEBAR_MIN_WIDTH, workbenchStore } from "../state/workbenchStore";

/** Widest the sidebar may go: the frame-relative cap is computed at drag
 *  time, this just bounds it on very large screens. */
const SIDEBAR_MAX_RATIO = 0.7;

export function SidebarSash() {
  function frameBounds(node: HTMLElement): { min: number; max: number } {
    const frame = node.closest(".wb-frame");
    const frameWidth = frame?.getBoundingClientRect().width ?? 1024;
    return { min: SIDEBAR_MIN_WIDTH, max: Math.max(SIDEBAR_MIN_WIDTH, Math.floor(frameWidth * SIDEBAR_MAX_RATIO)) };
  }

  /** Current aside width read from the DOM (the store holds the same number,
   *  but this works even if the grid has not re-laid-out yet). */
  function currentWidth(sash: HTMLElement): number {
    const aside = sash.closest(".wb-sidebar");
    return aside?.getBoundingClientRect().width ?? 264;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const sash = event.currentTarget;
    const { min, max } = frameBounds(sash);
    const startX = event.clientX;
    const startWidth = currentWidth(sash);
    sash.setPointerCapture(event.pointerId);
    document.body.classList.add("wb-resizing");

    const onMove = (move: PointerEvent) => {
      workbenchStore.setSidebarWidth(startWidth + move.clientX - startX);
    };
    const onUp = () => {
      sash.removeEventListener("pointermove", onMove);
      sash.removeEventListener("pointerup", onUp);
      sash.removeEventListener("pointercancel", onUp);
      document.body.classList.remove("wb-resizing");
    };
    sash.addEventListener("pointermove", onMove);
    sash.addEventListener("pointerup", onUp);
    sash.addEventListener("pointercancel", onUp);
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (currentWidth(event.currentTarget) > SIDEBAR_MIN_WIDTH + 8) workbenchStore.minimizeSidebar();
    else workbenchStore.restoreSidebar();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const { max } = frameBounds(event.currentTarget);
    const step = event.key === "ArrowLeft" ? -24 : 24;
    workbenchStore.maximizeSidebar(Math.min(max, currentWidth(event.currentTarget) + step));
  }

  function onExpandMax(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    workbenchStore.maximizeSidebar(frameBounds(event.currentTarget).max);
  }

  function onMinimize(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    workbenchStore.minimizeSidebar();
  }

  return (
    <div
      aria-label="Resize sidebar"
      aria-orientation="vertical"
      className="wb-sash"
      role="separator"
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <button
        aria-label="Expand sidebar"
        className="wb-sash-arrow"
        title="Expand"
        type="button"
        onClick={onExpandMax}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ChevronsLeft size={11} strokeWidth={2.5} />
      </button>
      <button
        aria-label="Minimize sidebar"
        className="wb-sash-arrow"
        title="Minimize"
        type="button"
        onClick={onMinimize}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ChevronsRight size={11} strokeWidth={2.5} />
      </button>
    </div>
  );
}
