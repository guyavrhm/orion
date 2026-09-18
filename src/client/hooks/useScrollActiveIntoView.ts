import { useEffect, type RefObject } from 'react';

/**
 * Automatically scrolls a container so that its active/selected item
 * is centered within the scrollable viewport on mount or when active item changes.
 *
 * @param containerRef Ref to the scrollable container (.overflow-y-auto)
 * @param activeSelector CSS selector to identify the active child (default: '[data-active="true"]')
 * @param trigger Optional dependency value (e.g. active item id / season / language) to re-trigger scroll
 */
export function useScrollActiveIntoView<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  activeSelector = '[data-active="true"]',
  trigger?: unknown
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scrollActiveIntoCenter = () => {
      const activeEl = container.querySelector(activeSelector) as HTMLElement | null;
      if (!activeEl) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      if (containerRect.height === 0) return;

      const currentOffset = activeRect.top - containerRect.top;
      const targetScrollTop =
        container.scrollTop + currentOffset - containerRect.height / 2 + activeRect.height / 2;

      container.scrollTop = Math.max(0, targetScrollTop);
    };

    scrollActiveIntoCenter();
    const raf = requestAnimationFrame(scrollActiveIntoCenter);
    return () => cancelAnimationFrame(raf);
  }, [containerRef, activeSelector, trigger]);
}
