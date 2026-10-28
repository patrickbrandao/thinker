import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Used until the scroller has a real layout height, so the first paint is windowed. */
export const VIRTUAL_LIST_DEFAULT_VIEWPORT = 480;
const DEFAULT_OVERSCAN = 8;

export interface VirtualListProps<T> {
  items: readonly T[];
  itemHeight: (item: T, index: number) => number;
  overscan?: number;
  /** Class of the scroller (kept from the Solid contract); `className` also works. */
  class?: string;
  className?: string;
  /** When this value changes, the scroller returns to the top. */
  resetKey?: unknown;
  /** Render one row. Rows are keyed by index within the visible window. */
  children: (item: T, index: number) => ReactNode;
}

/**
 * Windowed list: only the rows that intersect the scroller (plus `overscan`
 * on each side) are mounted; padding above and below keeps the scrollbar
 * honest. The caller sizes the scroller (e.g. `max-h-[60vh] overflow-y-auto`).
 */
export default function VirtualList<T>(props: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(VIRTUAL_LIST_DEFAULT_VIEWPORT);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollTopRef = useRef(scrollTop);
  scrollTopRef.current = scrollTop;

  const applyScrollTop = useCallback((next: number) => {
    setScrollTop(next);
    if (scroller.current) scroller.current.scrollTop = next;
  }, []);

  useEffect(() => {
    const el = scroller.current;
    const measure = () => {
      const height = el?.clientHeight ?? 0;
      if (height > 0) setViewport(height);
    };
    measure();
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Back to the top whenever resetKey changes (not on the first render).
  const lastResetKey = useRef(props.resetKey);
  useLayoutEffect(() => {
    if (props.resetKey === lastResetKey.current) return;
    lastResetKey.current = props.resetKey;
    applyScrollTop(0);
  }, [props.resetKey, applyScrollTop]);

  const { items, itemHeight } = props;
  const layout = useMemo(() => {
    const heights = items.map((item, index) => itemHeight(item, index));
    const offsets = new Array<number>(items.length);
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      offsets[i] = acc;
      acc += heights[i]!;
    }
    return { heights, offsets, total: acc };
  }, [items, itemHeight]);

  // Clamp when the list shrinks under the current scroll offset.
  useLayoutEffect(() => {
    const max = Math.max(0, layout.total - viewport);
    if (scrollTopRef.current > max) applyScrollTop(max);
  }, [layout, viewport, applyScrollTop]);

  const overscan = props.overscan ?? DEFAULT_OVERSCAN;
  const visible = useMemo(() => {
    const { heights, offsets, total } = layout;
    const top = scrollTop;
    const bottom = top + viewport;

    let lo = 0;
    let hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid]! + heights[mid]! <= top) lo = mid + 1;
      else hi = mid - 1;
    }
    const start = Math.max(0, lo - overscan);

    lo = start;
    hi = items.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid]! < bottom) lo = mid + 1;
      else hi = mid - 1;
    }
    const end = Math.min(items.length, lo + overscan);
    const slice: T[] = [];
    for (let i = start; i < end; i++) slice.push(items[i]!);
    const last = end - 1;
    return {
      start,
      slice,
      padTop: offsets[start] ?? 0,
      padBottom: total - (last < 0 ? 0 : (offsets[last] ?? 0) + (heights[last] ?? 0)),
    };
  }, [items, layout, scrollTop, viewport, overscan]);

  return (
    <div
      className={[props.class, props.className].filter(Boolean).join(' ') || undefined}
      ref={scroller}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div style={{ paddingTop: visible.padTop, paddingBottom: visible.padBottom }}>
        {visible.slice.map((item, i) => (
          <Fragment key={visible.start + i}>{props.children(item, visible.start + i)}</Fragment>
        ))}
      </div>
    </div>
  );
}
