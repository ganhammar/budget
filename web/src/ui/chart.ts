import { useCallback, useEffect, useRef, useState } from 'react';

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Which point the pointer is over.
 *
 * Touch needs different rules from a mouse. A finger produces no hover, so the
 * value has to be picked on press rather than on move, and it has to survive the
 * lift: pointerleave fires straight after pointerup on touch, so clearing there
 * would blank the reading the moment you took your finger off. A mouse still
 * clears on leave, which is what you expect there.
 */
export function usePointerIndex(count: number, toIndex: (clientX: number, rect: DOMRect) => number) {
  const [active, setActive] = useState<number | null>(null);

  const update = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const i = toIndex(e.clientX, rect);
      setActive(Math.max(0, Math.min(count - 1, i)));
    },
    [count, toIndex],
  );

  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      // Stops the long-press text selection and the iOS callout on the labels.
      e.preventDefault();
      update(e);
    },
    onPointerMove: update,
    onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.pointerType === 'mouse') setActive(null);
    },
  };

  return { active, setActive, handlers };
}
