// Pointer handling for the timeline: drag a block to another time (and, in
// the week view, another day), resize it from its bottom edge, or drag over
// empty time to select a span for a new block. Mouse, pen and touch all use
// pointer events:
//
// - mouse/pen: a press becomes a drag after DRAG_THRESHOLD_PX of movement;
//   a press without movement is a click (the block's own click handler opens
//   its actions; a click on empty time creates a block there);
// - touch: the grip and resize handles drag immediately (they have
//   `touch-action: none`); the block body starts dragging after a long press
//   (LONG_PRESS_MS without moving), so normal swipes still scroll the page;
//   a tap on empty time creates a block there;
// - Escape cancels a drag; nothing changes until the pointer is released.
//
// The engine keeps no React state of its own: it reports the ghost preview
// through `setPreview` and the result through `commitMove`/`commitCreate`.
import type { BlockView } from '../../lib/calendar';
import type { DateStr } from '../../model/types';
import { DRAG_THRESHOLD_PX, LONG_PRESS_MS, TOUCH_SLOP_PX, clickSpan, createSpan, moveSpan, resizeSpan, type Span } from './logic';

export interface TimelineGeometry {
  /** First minute shown. */
  rangeStart: number;
  /** Last minute shown. */
  rangeEnd: number;
  pxPerMinute: number;
}

export type DragKind = 'move' | 'resize' | 'create';

export interface DragPreview {
  kind: DragKind;
  /** The block being moved/resized (null while creating). */
  blockId: string | null;
  date: DateStr;
  span: Span;
}

export interface DragEngineDeps {
  geometry: () => TimelineGeometry;
  /** Day columns in display order. */
  columns: () => Array<{ date: DateStr; element: HTMLElement }>;
  /** Moving a block may change its day (week view). */
  crossDay: () => boolean;
  setPreview: (preview: DragPreview | null) => void;
  commitMove: (view: BlockView, date: DateStr, span: Span) => void;
  commitCreate: (date: DateStr, span: Span) => void;
}

interface Session {
  kind: DragKind;
  pointerId: number;
  touch: boolean;
  /** Long-press required before dragging (touch on the block body). */
  needsLongPress: boolean;
  view: BlockView | null;
  originDate: DateStr;
  originSpan: Span;
  /** Minutes between the pointer and the block start (move) or end (resize) at the press. */
  grabOffset: number;
  /** Minute under the pointer at the press (create). */
  anchor: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  active: boolean;
  moved: boolean;
  timer: number | null;
  current: { date: DateStr; span: Span } | null;
}

export interface DragEngine {
  /** pointerdown on a block (body or handle). */
  blockPointerDown: (event: PointerLikeEvent, view: BlockView, date: DateStr, kind: 'move' | 'resize', handle: boolean) => void;
  /** pointerdown on empty time of a day column. */
  columnPointerDown: (event: PointerLikeEvent, date: DateStr) => void;
  /** True right after a drag ended, so the click that follows is ignored. */
  shouldSuppressClick: () => boolean;
  /** A press or drag is in progress. */
  busy: () => boolean;
  cancel: () => void;
}

/** The parts of a (React or DOM) pointer event the engine reads. */
export interface PointerLikeEvent {
  pointerId?: number;
  pointerType?: string;
  button: number;
  clientX: number;
  clientY: number;
  target: EventTarget | null;
  preventDefault: () => void;
}

const EDGE_PX = 48;

function stickyHeaderBottom(): number {
  try {
    const header = document.querySelector('header');
    if (!header) return 0;
    const position = getComputedStyle(header).position;
    return position === 'sticky' || position === 'fixed' ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  } catch {
    return 0;
  }
}
const MAX_SCROLL_STEP = 18;

export function createDragEngine(deps: DragEngineDeps): DragEngine {
  let session: Session | null = null;
  let suppressUntil = 0;
  let scrollFrame: number | null = null;
  /** Height of a sticky page header covering the top of the viewport (auto-scroll starts below it). */
  let topInset = 0;

  const columnElement = (date: DateStr): HTMLElement | null => deps.columns().find((c) => c.date === date)?.element ?? null;

  const minutesAt = (date: DateStr, clientY: number): number => {
    const g = deps.geometry();
    const el = columnElement(date);
    const top = el ? el.getBoundingClientRect().top : 0;
    return g.rangeStart + (clientY - top) / g.pxPerMinute;
  };

  const dateAt = (clientX: number, fallback: DateStr): DateStr => {
    const cols = deps.columns();
    if (cols.length <= 1) return fallback;
    // Left of the first column → first day; right of the last → last day.
    for (const col of cols) {
      const rect = col.element.getBoundingClientRect();
      if (rect.width <= 0) return fallback;
      if (clientX < rect.right) return col.date;
    }
    return cols[cols.length - 1].date;
  };

  const update = () => {
    const s = session;
    if (!s || !s.active) return;
    // Stay inside the hours shown (or the block's own hours, if it is already outside them).
    const g = deps.geometry();
    const lo = Math.min(g.rangeStart, s.kind === 'create' ? g.rangeStart : s.originSpan.start);
    const hi = Math.max(g.rangeEnd, s.kind === 'create' ? g.rangeEnd : s.originSpan.end);
    const at = (d: DateStr) => Math.min(hi, Math.max(lo, minutesAt(d, s.lastY)));
    let date = s.originDate;
    let span: Span;
    if (s.kind === 'move') {
      if (deps.crossDay()) date = dateAt(s.lastX, s.originDate);
      const length = s.originSpan.end - s.originSpan.start;
      const start = Math.min(hi - length, Math.max(lo, minutesAt(date, s.lastY) - s.grabOffset));
      span = moveSpan(s.originSpan, start);
    } else if (s.kind === 'resize') {
      span = resizeSpan(s.originSpan, Math.min(hi, Math.max(lo, minutesAt(date, s.lastY) - s.grabOffset)));
    } else {
      span = createSpan(Math.min(hi, Math.max(lo, s.anchor)), at(date));
    }
    const prev = s.current;
    if (prev && prev.date === date && prev.span.start === span.start && prev.span.end === span.end) return;
    s.current = { date, span };
    deps.setPreview({ kind: s.kind, blockId: s.view ? s.view.block.id : null, date, span });
  };

  const stopScroll = () => {
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  };

  const autoScroll = () => {
    scrollFrame = null;
    const s = session;
    if (!s || !s.active || typeof window === 'undefined') return;
    const h = window.innerHeight;
    const top = topInset + EDGE_PX;
    let step = 0;
    // Scroll only in the direction the pointer has moved since the press, so
    // grabbing a block that sits near an edge does not scroll by itself.
    if (s.lastY < top && s.lastY < s.startY) step = -Math.ceil((Math.min(EDGE_PX, top - s.lastY) / EDGE_PX) * MAX_SCROLL_STEP);
    else if (s.lastY > h - EDGE_PX && s.lastY > s.startY) step = Math.ceil((Math.min(EDGE_PX, s.lastY - (h - EDGE_PX)) / EDGE_PX) * MAX_SCROLL_STEP);
    if (step === 0) return;
    window.scrollBy(0, step);
    update();
    scrollFrame = requestAnimationFrame(autoScroll);
  };

  const activate = () => {
    const s = session;
    if (!s || s.active) return;
    s.active = true;
    if (s.timer !== null) window.clearTimeout(s.timer);
    s.timer = null;
    if (s.touch && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(10);
      } catch {
        /* not allowed: ignore */
      }
    }
    update();
  };

  const finish = () => {
    const s = session;
    if (s && s.timer !== null) window.clearTimeout(s.timer);
    session = null;
    stopScroll();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('touchmove', onTouchMove);
  };

  const suppressClick = () => {
    suppressUntil = Date.now() + 400;
  };

  function onMove(event: PointerEvent) {
    const s = session;
    if (!s || (event.pointerId !== undefined && event.pointerId !== s.pointerId)) return;
    s.lastX = event.clientX;
    s.lastY = event.clientY;
    const distance = Math.hypot(event.clientX - s.startX, event.clientY - s.startY);
    if (!s.active) {
      if (s.touch && (s.needsLongPress || s.kind === 'create')) {
        // A swipe before the long press (or on empty time) is a scroll.
        if (distance > TOUCH_SLOP_PX) finish();
        return;
      }
      if (distance > DRAG_THRESHOLD_PX) {
        s.moved = true;
        activate();
      }
      return;
    }
    s.moved = s.moved || distance > DRAG_THRESHOLD_PX;
    update();
    const nearTop = s.lastY < topInset + EDGE_PX && s.lastY < s.startY;
    const nearBottom = s.lastY > window.innerHeight - EDGE_PX && s.lastY > s.startY;
    if (scrollFrame === null && (nearTop || nearBottom)) scrollFrame = requestAnimationFrame(autoScroll);
  }

  function onUp(event: PointerEvent) {
    const s = session;
    if (!s || (event.pointerId !== undefined && event.pointerId !== s.pointerId)) return;
    if (!s.active) {
      finish();
      // A press without movement on empty time creates a block there.
      if (s.kind === 'create') deps.commitCreate(s.originDate, clickSpan(s.anchor));
      return;
    }
    const result = s.current;
    const view = s.view;
    finish();
    deps.setPreview(null);
    suppressClick();
    if (!result) return;
    if (s.kind === 'create') {
      deps.commitCreate(result.date, result.span);
      return;
    }
    const changed = result.date !== s.originDate || result.span.start !== s.originSpan.start || result.span.end !== s.originSpan.end;
    if (changed && view) deps.commitMove(view, result.date, result.span);
  }

  function onCancel(event: PointerEvent) {
    const s = session;
    if (!s || (event.pointerId !== undefined && event.pointerId !== s.pointerId)) return;
    const wasActive = s.active;
    finish();
    if (wasActive) {
      deps.setPreview(null);
      suppressClick();
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !session) return;
    event.preventDefault();
    event.stopPropagation();
    const wasActive = session.active;
    finish();
    if (wasActive) {
      deps.setPreview(null);
      suppressClick();
    }
  }

  function onTouchMove(event: TouchEvent) {
    // While a touch drag is active the page must not scroll.
    if (session && session.active && event.cancelable) event.preventDefault();
  }

  const start = (event: PointerLikeEvent, init: Omit<Session, 'pointerId' | 'touch' | 'startX' | 'startY' | 'lastX' | 'lastY' | 'active' | 'moved' | 'timer' | 'current'>) => {
    const pointerType = event.pointerType || 'mouse';
    if (pointerType === 'mouse' && event.button !== 0) return;
    if (session) {
      // A second finger: give up rather than guess.
      finish();
      deps.setPreview(null);
      return;
    }
    session = {
      ...init,
      pointerId: event.pointerId ?? 1,
      touch: pointerType === 'touch',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      active: false,
      moved: false,
      timer: null,
      current: null,
    };
    if (session.touch && session.needsLongPress) session.timer = window.setTimeout(activate, LONG_PRESS_MS);
    topInset = stickyHeaderBottom();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
  };

  return {
    blockPointerDown(event, view, date, kind, handle) {
      const pointerType = event.pointerType || 'mouse';
      if (handle) event.preventDefault();
      start(event, {
        kind,
        needsLongPress: pointerType === 'touch' && !handle,
        view,
        originDate: date,
        originSpan: { start: view.start, end: view.end },
        // Resizing keeps the pointer's distance from the block's end, so the
        // end does not jump when the handle is grabbed a few pixels above it.
        grabOffset: minutesAt(date, event.clientY) - (kind === 'resize' ? view.end : view.start),
        anchor: 0,
      });
    },
    columnPointerDown(event, date) {
      const target = event.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest('[data-tl-item]')) return;
      start(event, {
        kind: 'create',
        needsLongPress: false,
        view: null,
        originDate: date,
        originSpan: { start: 0, end: 0 },
        grabOffset: 0,
        anchor: minutesAt(date, event.clientY),
      });
    },
    shouldSuppressClick: () => Date.now() < suppressUntil,
    busy: () => session !== null,
    cancel() {
      const wasActive = !!session?.active;
      finish();
      if (wasActive) deps.setPreview(null);
    },
  };
}
