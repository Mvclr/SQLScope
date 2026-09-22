'use client';

import { useLayoutEffect, useRef, useState } from 'react';

export interface IndicatorBox {
  readonly left: number;
  readonly width: number;
}

/**
 * Where the highlight behind the active item of a segmented control should sit, so it can
 * slide between items instead of jumping. Items mark themselves with `data-indicator`
 * equal to their key; the container must be `position: relative`.
 */
export function useSlidingIndicator<T extends HTMLElement>(active: string | null) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<IndicatorBox | null>(null);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const measure = () => {
      const item = active
        ? container.querySelector<HTMLElement>(`[data-indicator="${CSS.escape(active)}"]`)
        : null;
      setBox((current) => {
        if (!item) return null;
        const next = { left: item.offsetLeft, width: item.offsetWidth };
        return current?.left === next.left && current.width === next.width ? current : next;
      });
    };
    measure();
    // Labels change width when fonts load or the window narrows.
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active]);

  return { ref, box };
}
