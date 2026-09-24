import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type SectionLayoutType = 'row' | 'grid' | 'list';

export interface SectionConfig {
  id: string;
  type?: SectionLayoutType;
  columns?: number;
}

export interface FocusableNode {
  id: string;
  zone: string;
  section?: string;
  index?: number;
  element: HTMLElement | null;
  onEnter?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  priority?: number;
  disabled?: boolean;
}

export interface SpatialNavigationActions {
  register: (node: FocusableNode) => void;
  unregister: (id: string, element?: HTMLElement | null) => void;
  setFocused: (id: string | null, scrollToView?: boolean) => void;
  pushZone: (zone: string, defaultFocusId?: string) => void;
  popZone: (zone: string) => void;
  registerZoneBack: (zone: string, onBack: () => void) => () => void;
  triggerBack: () => void;
  navigate: (direction: Direction) => void;
  triggerEnter: () => void;
  registerSection: (zone: string, section: SectionConfig, orderIndex?: number) => void;
  unregisterSection: (zone: string, sectionId: string) => void;
  subscribeFocus: (id: string, callback: (isFocused: boolean) => void) => () => void;
  getFocusedId: () => string | null;
}

export interface SpatialNavigationState {
  activeZone: string;
  isKeyboardNav: boolean;
}

const SpatialNavigationActionsContext = createContext<SpatialNavigationActions | null>(null);
const SpatialNavigationStateContext = createContext<SpatialNavigationState | null>(null);

// Modular, Declarative Section Configurations per Zone
export const DEFAULT_ZONE_SECTIONS: Record<string, SectionConfig[]> = {
  explore: [
    { id: 'header', type: 'row' },
    { id: 'hero', type: 'row' },
    { id: 'continue-watching', type: 'row' },
    { id: 'popular-movies', type: 'row' },
    { id: 'trending-shows', type: 'row' },
  ],
  detail: [
    { id: 'detail-header', type: 'row' },
    { id: 'detail-hero-action', type: 'row' },
    { id: 'detail-seasons', type: 'row' },
    { id: 'detail-episodes', type: 'grid' },
  ],
  search: [
    { id: 'search-header', type: 'row' },
    { id: 'search-results', type: 'list' },
  ],
  player: [
    { id: 'player-top', type: 'row' },
    { id: 'player-middle', type: 'row' },
    { id: 'player-timeline', type: 'row' },
    { id: 'player-bottom', type: 'row' },
  ],
  'season-menu': [
    { id: 'dropdown-items', type: 'list' },
  ],
  'player-menu': [
    { id: 'player-menu-subtitles', type: 'list' },
    { id: 'player-menu-speeds', type: 'grid', columns: 3 },
  ],
};

// Backwards-compatible section exports
export const EXPLORE_SECTIONS = DEFAULT_ZONE_SECTIONS.explore.map((s) => s.id);
export const DETAIL_SECTIONS = DEFAULT_ZONE_SECTIONS.detail.map((s) => s.id);
export const SEARCH_SECTIONS = DEFAULT_ZONE_SECTIONS.search.map((s) => s.id);
export const PLAYER_SECTIONS = DEFAULT_ZONE_SECTIONS.player.map((s) => s.id);

/**
 * Fast, non-layout-thrashing responsive grid column calculator
 */
export function getResponsiveGridColumns(specifiedCols?: number): number {
  if (specifiedCols && specifiedCols > 0) return specifiedCols;
  if (typeof window === 'undefined') return 1;
  const width = window.innerWidth;
  if (width >= 1280) return 4;
  if (width >= 1024) return 3;
  if (width >= 640) return 2;
  return 1;
}

/**
 * 2D Geometric Distance Calculation (Fallback for unsectioned or arbitrary layouts)
 */
export function getGeometricDistance(
  current: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number },
  candidate: DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number },
  direction: Direction
): number | null {
  const cCenterX = current.left + current.width / 2;
  const cCenterY = current.top + current.height / 2;
  const tCenterX = candidate.left + candidate.width / 2;
  const tCenterY = candidate.top + candidate.height / 2;

  const dx = tCenterX - cCenterX;
  const dy = tCenterY - cCenterY;

  const verticalOverlap = !(candidate.bottom <= current.top || candidate.top >= current.bottom);
  const horizontalOverlap = !(candidate.right <= current.left || candidate.left >= current.right);

  let primaryDist = 0;
  let crossDist = 0;

  switch (direction) {
    case 'right': {
      if (candidate.left < current.right - 5 && dx <= 0) return null;
      if (!verticalOverlap && dx <= Math.abs(dy) * 1.5) return null;
      primaryDist = Math.max(0, candidate.left - current.right);
      crossDist = Math.abs(dy);
      return primaryDist + crossDist * 3 + (verticalOverlap ? 0 : 1000);
    }
    case 'left': {
      if (candidate.right > current.left + 5 && dx >= 0) return null;
      if (!verticalOverlap && -dx <= Math.abs(dy) * 1.5) return null;
      primaryDist = Math.max(0, current.left - candidate.right);
      crossDist = Math.abs(dy);
      return primaryDist + crossDist * 3 + (verticalOverlap ? 0 : 1000);
    }
    case 'down': {
      if (candidate.top < current.bottom - 5 && dy <= 0) return null;
      if (!horizontalOverlap && dy <= Math.abs(dx) * 0.3) return null;
      primaryDist = Math.max(0, candidate.top - current.bottom);
      crossDist = Math.abs(dx);
      return primaryDist + crossDist * 1.5 + (horizontalOverlap ? 0 : 300);
    }
    case 'up': {
      if (candidate.bottom > current.top + 5 && dy >= 0) return null;
      if (!horizontalOverlap && -dy <= Math.abs(dx) * 0.3) return null;
      primaryDist = Math.max(0, current.top - candidate.bottom);
      crossDist = Math.abs(dx);
      return primaryDist + crossDist * 1.5 + (horizontalOverlap ? 0 : 300);
    }
  }
}

/**
 * Universal Remote and Keyboard Back Key Detector.
 * Supports standard Escape (27), Android TV / Fire TV back (4),
 * Samsung Tizen (10009 / Return), LG webOS (461), and Browser Back (166).
 */
export function isBackKey(e: KeyboardEvent): boolean {
  const code = e.keyCode || e.which;
  const key = e.key;
  return (
    key === 'Escape' ||
    key === 'Back' ||
    key === 'GoBack' ||
    key === 'BrowserBack' ||
    key === 'XF86Back' ||
    code === 27 ||
    code === 4 ||
    code === 10009 ||
    code === 461 ||
    code === 166
  );
}

interface SpatialNavigationProviderProps {
  children: ReactNode;
  initialZone?: string;
}

export function SpatialNavigationProvider({
  children,
  initialZone = 'explore',
}: SpatialNavigationProviderProps) {
  const [activeZone, setActiveZone] = useState<string>(initialZone);
  const activeZoneRef = useRef<string>(initialZone);
  const [isKeyboardNav, setIsKeyboardNav] = useState<boolean>(false);
  const isKeyboardNavRef = useRef<boolean>(false);

  const zoneStackRef = useRef<string[]>([initialZone]);
  const zoneBackHandlersRef = useRef<Map<string, () => void>>(new Map());
  const zoneSectionsRef = useRef<Map<string, SectionConfig[]>>(new Map());

  // In-memory node registry and fine-grained subscriber listeners
  const nodesRef = useRef<Map<string, FocusableNode>>(new Map());
  const focusedIdRef = useRef<string | null>(null);
  const nodeSubscribersRef = useRef<Map<string, Set<(isFocused: boolean) => void>>>(new Map());

  const zoneFocusMemoryRef = useRef<Map<string, string>>(new Map());
  const sectionFocusMemoryRef = useRef<Map<string, string>>(new Map());
  const pendingFocusIdRef = useRef<string | null>(null);
  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);
  const lastKeyNavTimeRef = useRef<number>(0);

  // Initialize default zone sections
  useEffect(() => {
    Object.entries(DEFAULT_ZONE_SECTIONS).forEach(([zone, sections]) => {
      zoneSectionsRef.current.set(zone, [...sections]);
    });
  }, []);

  useEffect(() => {
    activeZoneRef.current = activeZone;
  }, [activeZone]);

  useEffect(() => {
    isKeyboardNavRef.current = isKeyboardNav;
    if (typeof document !== 'undefined') {
      if (isKeyboardNav) {
        document.body.classList.add('keyboard-nav-active');
      } else {
        document.body.classList.remove('keyboard-nav-active');
      }
    }
  }, [isKeyboardNav]);

  const notifyNode = useCallback((id: string, isFocused: boolean) => {
    const subscribers = nodeSubscribersRef.current.get(id);
    if (subscribers) {
      subscribers.forEach((cb) => cb(isFocused));
    }
  }, []);

  const subscribeFocus = useCallback((id: string, callback: (isFocused: boolean) => void) => {
    let set = nodeSubscribersRef.current.get(id);
    if (!set) {
      set = new Set();
      nodeSubscribersRef.current.set(id, set);
    }
    set.add(callback);
    // Initial call
    callback(focusedIdRef.current === id);
    return () => {
      const currentSet = nodeSubscribersRef.current.get(id);
      if (currentSet) {
        currentSet.delete(callback);
        if (currentSet.size === 0) {
          nodeSubscribersRef.current.delete(id);
        }
      }
    };
  }, []);

  const getFocusedId = useCallback(() => focusedIdRef.current, []);

  const setFocused = useCallback((id: string | null, scrollToView = true) => {
    const prevId = focusedIdRef.current;
    if (prevId === id) return;

    if (prevId) {
      const oldNode = nodesRef.current.get(prevId);
      oldNode?.onBlur?.();
      notifyNode(prevId, false);
    }

    focusedIdRef.current = id;

    if (id) {
      const newNode = nodesRef.current.get(id);
      newNode?.onFocus?.();
      if (newNode?.zone) {
        zoneFocusMemoryRef.current.set(newNode.zone, id);
      }
      if (newNode?.section) {
        sectionFocusMemoryRef.current.set(newNode.section, id);
      }
      notifyNode(id, true);

      if (scrollToView && isKeyboardNavRef.current && newNode?.element) {
        if (
          newNode.section === 'dropdown-items' ||
          newNode.section === 'player-menu-items' ||
          newNode.zone.endsWith('-menu') ||
          newNode.zone.endsWith('-dropdown') ||
          newNode.section === 'search-results'
        ) {
          // Only scroll the dropdown/results list container without scrolling the main page/window
          const parentScroll = newNode.element.closest('.overflow-y-auto') as HTMLElement | null;
          if (parentScroll) {
            const parentRect = parentScroll.getBoundingClientRect();
            const nodeRect = newNode.element.getBoundingClientRect();
            if (nodeRect.top < parentRect.top) {
              parentScroll.scrollTop -= parentRect.top - nodeRect.top + 4;
            } else if (nodeRect.bottom > parentRect.bottom) {
              parentScroll.scrollTop += nodeRect.bottom - parentRect.bottom + 4;
            }
          }
        } else if (
          newNode.section === 'header' ||
          newNode.section === 'detail-header' ||
          id === 'header-search-trigger' ||
          id === 'header-back-btn' ||
          id === 'header-season-dropdown-btn' ||
          id === 'search-close-btn' ||
          (newNode.zone === 'explore' && (newNode.section === 'hero' || id === 'hero-carousel-card'))
        ) {
          // Scroll both detail container (if present) and window all the way to the top
          const detailContainer =
            (newNode.element?.closest('.overflow-y-auto') as HTMLElement | null) ||
            (typeof document !== 'undefined'
              ? (document.querySelector('.fixed.inset-0.overflow-y-auto') as HTMLElement | null) ||
                (document.querySelector('.overflow-y-auto') as HTMLElement | null)
              : null);
          if (detailContainer && detailContainer.scrollTop > 0) {
            detailContainer.scrollTo({ top: 0, behavior: 'smooth' });
          }
          if (typeof window !== 'undefined' && window.scrollY > 0) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        } else {
          newNode.element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'nearest',
          });
        }
      }
    }
  }, [notifyNode]);

  const register = useCallback((node: FocusableNode) => {
    nodesRef.current.set(node.id, node);
    if (pendingFocusIdRef.current === node.id) {
      pendingFocusIdRef.current = null;
      setFocused(node.id, isKeyboardNavRef.current);
    }
  }, [setFocused]);

  const unregister = useCallback((id: string, element?: HTMLElement | null) => {
    if (element) {
      const existing = nodesRef.current.get(id);
      if (existing && existing.element && existing.element !== element) {
        return;
      }
    }
    nodesRef.current.delete(id);
    if (focusedIdRef.current === id) {
      queueMicrotask(() => {
        if (!nodesRef.current.has(id) && focusedIdRef.current === id) {
          setFocused(null, false);
        }
      });
    }
  }, [setFocused]);

  const registerSection = useCallback((zone: string, section: SectionConfig, orderIndex?: number) => {
    const list = zoneSectionsRef.current.get(zone) || [];
    const existingIdx = list.findIndex((s) => s.id === section.id);
    if (existingIdx !== -1) {
      list[existingIdx] = { ...list[existingIdx], ...section };
    } else if (typeof orderIndex === 'number') {
      list.splice(orderIndex, 0, section);
    } else {
      list.push(section);
    }
    zoneSectionsRef.current.set(zone, list);
  }, []);

  const unregisterSection = useCallback((zone: string, sectionId: string) => {
    const list = zoneSectionsRef.current.get(zone);
    if (list) {
      zoneSectionsRef.current.set(zone, list.filter((s) => s.id !== sectionId));
    }
  }, []);

  const pushZone = useCallback((zone: string, defaultFocusId?: string) => {
    const stack = zoneStackRef.current;
    if (stack[stack.length - 1] !== zone) {
      stack.push(zone);
    }
    setActiveZone(zone);
    activeZoneRef.current = zone;

    const shouldScroll = isKeyboardNavRef.current;

    if (defaultFocusId) {
      zoneFocusMemoryRef.current.delete(zone);
      pendingFocusIdRef.current = defaultFocusId;
      if (nodesRef.current.has(defaultFocusId)) {
        pendingFocusIdRef.current = null;
        setFocused(defaultFocusId, shouldScroll);
        return;
      }
    }

    requestAnimationFrame(() => {
      if (defaultFocusId && nodesRef.current.has(defaultFocusId)) {
        pendingFocusIdRef.current = null;
        setFocused(defaultFocusId, isKeyboardNavRef.current);
        return;
      }
      const remembered = zoneFocusMemoryRef.current.get(zone);
      if (remembered && nodesRef.current.has(remembered)) {
        setFocused(remembered, isKeyboardNavRef.current);
        return;
      }
      const zoneNodes = Array.from(nodesRef.current.values()).filter(
        (n) => n.zone === zone && n.element && !n.disabled
      );
      const autoFocusNode = zoneNodes.find((n) => n.autoFocus);
      if (autoFocusNode) {
        setFocused(autoFocusNode.id, isKeyboardNavRef.current);
      } else if (zoneNodes.length > 0) {
        zoneNodes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        setFocused(zoneNodes[0].id, isKeyboardNavRef.current);
      }
    });
  }, [setFocused]);

  const popZone = useCallback((zone: string) => {
    // Clear transient overlay memory
    if (
      zone === 'detail' ||
      zone === 'search' ||
      zone === 'player' ||
      zone.endsWith('-dropdown') ||
      zone.endsWith('-menu') ||
      zone === 'season-menu' ||
      zone === 'player-menu'
    ) {
      zoneFocusMemoryRef.current.delete(zone);
    }
    pendingFocusIdRef.current = null;

    const stack = zoneStackRef.current;
    const idx = stack.lastIndexOf(zone);
    if (idx !== -1) {
      stack.splice(idx, 1);
    }
    const newActive = stack[stack.length - 1] || 'explore';
    setActiveZone(newActive);
    activeZoneRef.current = newActive;

    const shouldScroll = isKeyboardNavRef.current;

    // Restore focus to previous zone
    const remembered = zoneFocusMemoryRef.current.get(newActive);
    if (remembered && nodesRef.current.has(remembered)) {
      setFocused(remembered, shouldScroll);
    } else {
      const zoneNodes = Array.from(nodesRef.current.values()).filter(
        (n) => n.zone === newActive && n.element && !n.disabled
      );
      if (zoneNodes.length > 0) {
        zoneNodes.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        setFocused(zoneNodes[0].id, shouldScroll);
      }
    }
  }, [setFocused]);

  const registerZoneBack = useCallback((zone: string, onBack: () => void) => {
    zoneBackHandlersRef.current.set(zone, onBack);
    return () => {
      if (zoneBackHandlersRef.current.get(zone) === onBack) {
        zoneBackHandlersRef.current.delete(zone);
      }
    };
  }, []);

  const triggerBack = useCallback(() => {
    const stack = zoneStackRef.current;
    if (stack.length <= 1) {
      if (typeof window !== 'undefined' && (window as any).AndroidApp?.showExitDialog) {
        try {
          (window as any).AndroidApp.showExitDialog();
        } catch {}
      }
      return;
    }

    const currentZone = stack[stack.length - 1];
    const backHandler = zoneBackHandlersRef.current.get(currentZone);

    if (backHandler) {
      backHandler();
    } else {
      popZone(currentZone);
    }
  }, [popZone]);

  /**
   * Generic, Decoupled Section-Driven Navigation Engine
   */
  const navigate = useCallback(
    (direction: Direction) => {
      lastKeyNavTimeRef.current = Date.now();
      if (!isKeyboardNavRef.current) {
        setIsKeyboardNav(true);
      }

      const currentZone = activeZoneRef.current;
      const currentId = focusedIdRef.current;
      const currentFocused = currentId ? nodesRef.current.get(currentId) : null;
      const zoneNodes = Array.from(nodesRef.current.values()).filter(
        (n) => n.zone === currentZone && n.element && n.element.isConnected && !n.disabled
      );

      if (zoneNodes.length === 0) return;

      // 1. Initial focus if none active in current zone
      if (!currentFocused || !currentFocused.element || currentFocused.zone !== currentZone) {
        const remembered = zoneFocusMemoryRef.current.get(currentZone);
        const target =
          (remembered && zoneNodes.find((n) => n.id === remembered)) ||
          zoneNodes.find((n) => n.autoFocus) ||
          zoneNodes[0];
        if (target) {
          setFocused(target.id, true);
        }
        return;
      }

      // 2. Explicit node directional overrides
      if (direction === 'left' && currentFocused.onLeft) {
        currentFocused.onLeft();
        return;
      }
      if (direction === 'right' && currentFocused.onRight) {
        currentFocused.onRight();
        return;
      }
      if (direction === 'up' && currentFocused.onUp) {
        currentFocused.onUp();
        return;
      }
      if (direction === 'down' && currentFocused.onDown) {
        currentFocused.onDown();
        return;
      }

      // 3. Section-Based Navigation
      const currentSectionId = currentFocused.section;
      if (currentSectionId) {
        const configuredSections = zoneSectionsRef.current.get(currentZone) || [];
        const currentSecConfig =
          configuredSections.find((s) => s.id === currentSectionId) || {
            id: currentSectionId,
            type: 'row' as SectionLayoutType,
          };
        const layoutType: SectionLayoutType = currentSecConfig.type || 'row';

        const sectionNodes = zoneNodes
          .filter((n) => n.section === currentSectionId)
          .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

        const curIndex = sectionNodes.findIndex((n) => n.id === currentFocused.id);

        // 3.1 Horizontal Navigation (Left / Right)
        if (direction === 'left' || direction === 'right') {
          if (curIndex === -1) return;

          if (layoutType === 'grid') {
            const cols = getResponsiveGridColumns(currentSecConfig.columns);
            const colIndex = curIndex % cols;

            if (direction === 'left') {
              if (colIndex > 0 && curIndex > 0) {
                setFocused(sectionNodes[curIndex - 1].id, true);
              }
            } else if (direction === 'right') {
              if (colIndex < cols - 1 && curIndex < sectionNodes.length - 1) {
                setFocused(sectionNodes[curIndex + 1].id, true);
              }
            }
            return;
          }

          if (layoutType === 'row') {
            if (direction === 'left') {
              if (curIndex > 0) {
                setFocused(sectionNodes[curIndex - 1].id, true);
              }
            } else if (direction === 'right') {
              if (curIndex < sectionNodes.length - 1) {
                setFocused(sectionNodes[curIndex + 1].id, true);
              }
            }
            return;
          }

          // For vertical lists, left/right stops at boundary
          return;
        }

        // 3.2 Vertical Navigation (Up / Down)
        if (direction === 'up' || direction === 'down') {
          // Inner Grid vertical movement
          if (layoutType === 'grid' && curIndex !== -1) {
            const cols = getResponsiveGridColumns(currentSecConfig.columns);
            if (direction === 'up' && curIndex >= cols) {
              setFocused(sectionNodes[curIndex - cols].id, true);
              return;
            }
            if (direction === 'down') {
              if (curIndex + cols < sectionNodes.length) {
                setFocused(sectionNodes[curIndex + cols].id, true);
                return;
              }
              if (
                curIndex < sectionNodes.length - 1 &&
                Math.floor(curIndex / cols) < Math.floor((sectionNodes.length - 1) / cols)
              ) {
                setFocused(sectionNodes[sectionNodes.length - 1].id, true);
                return;
              }
              return; // Bottom row boundary
            }
          }

          // Inner Vertical List movement
          if (layoutType === 'list' && curIndex !== -1) {
            if (direction === 'down' && curIndex < sectionNodes.length - 1) {
              setFocused(sectionNodes[curIndex + 1].id, true);
              return;
            }
            if (direction === 'up' && curIndex > 0) {
              setFocused(sectionNodes[curIndex - 1].id, true);
              return;
            }
          }

          // Inter-Section Transition (moving between sections in the zone hierarchy)
          const curSecIdx = configuredSections.findIndex((s) => s.id === currentSectionId);
          if (curSecIdx !== -1) {
            const step = direction === 'down' ? 1 : -1;
            let targetSecIdx = curSecIdx + step;

            const currentRect = currentFocused.element?.getBoundingClientRect();
            const currentCenterX = currentRect ? currentRect.left + currentRect.width / 2 : null;

            while (targetSecIdx >= 0 && targetSecIdx < configuredSections.length) {
              const candidateSec = configuredSections[targetSecIdx];
              const candidateNodes = zoneNodes
                .filter((n) => n.section === candidateSec.id)
                .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

              if (candidateNodes.length > 0) {
                // If moving down from Hero carousel, restore remembered card or first item
                if (currentSectionId === 'hero' && direction === 'down') {
                  const rememberedId = sectionFocusMemoryRef.current.get(candidateSec.id);
                  const target = (rememberedId ? candidateNodes.find((n) => n.id === rememberedId) : null) || candidateNodes[0];
                  if (target) {
                    setFocused(target.id, true);
                    return;
                  }
                }

                // If target section has a single element (e.g. hero card, action button), select it immediately
                if (candidateNodes.length === 1) {
                  setFocused(candidateNodes[0].id, true);
                  return;
                }

                // If moving into a section with a high-priority active item (e.g. active season tab), focus it
                const priorityNode = candidateNodes.find((n) => (n.priority ?? 0) > 0);
                if (priorityNode) {
                  setFocused(priorityNode.id, true);
                  return;
                }

                // If moving into a 2D Grid:
                // Down into grid -> enter first row only
                // Up into grid -> enter last row only
                let targetCandidatePool = candidateNodes;
                const candidateSecType = candidateSec.type || 'row';
                if (candidateSecType === 'grid') {
                  const cols = getResponsiveGridColumns(candidateSec.columns);
                  if (direction === 'down') {
                    targetCandidatePool = candidateNodes.slice(0, cols);
                  } else {
                    const rowCount = Math.ceil(candidateNodes.length / cols);
                    const lastRowStart = (rowCount - 1) * cols;
                    targetCandidatePool = candidateNodes.slice(lastRowStart);
                  }
                }

                // Physical X-coordinate alignment for horizontal shelves and grids
                let targetNode = targetCandidatePool[0];
                if (currentCenterX !== null && currentCenterX > 0) {
                  let minDx = Infinity;
                  for (const node of targetCandidatePool) {
                    if (node.element) {
                      const rect = node.element.getBoundingClientRect();
                      const nodeCenterX = rect.left + rect.width / 2;
                      const dx = Math.abs(nodeCenterX - currentCenterX);
                      if (dx < minDx) {
                        minDx = dx;
                        targetNode = node;
                      }
                    }
                  }
                } else {
                  const targetIdx = Math.min(currentFocused.index ?? 0, targetCandidatePool.length - 1);
                  targetNode = targetCandidatePool[targetIdx];
                }

                if (targetNode) {
                  setFocused(targetNode.id, true);
                  return;
                }
              }

              targetSecIdx += step;
            }
            return;
          }
        }
      }

      // 4. Fallback 2D Geometric Cone Navigation (For unsectioned layouts)
      const currentRect = currentFocused.element.getBoundingClientRect();
      let bestCandidate: FocusableNode | null = null;
      let minDistance = Infinity;

      for (const candidate of zoneNodes) {
        if (candidate.id === currentFocused.id || !candidate.element) continue;

        const candidateRect = candidate.element.getBoundingClientRect();
        if (candidateRect.width === 0 || candidateRect.height === 0) continue;

        const dist = getGeometricDistance(currentRect, candidateRect, direction);
        if (dist !== null && dist < minDistance) {
          minDistance = dist;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        setFocused(bestCandidate.id, true);
      }
    },
    [setFocused]
  );

  const triggerEnter = useCallback(() => {
    const currentId = focusedIdRef.current;
    if (!currentId) return;
    const node = nodesRef.current.get(currentId);
    if (node) {
      if (node.onEnter) {
        node.onEnter();
      } else if (node.element) {
        node.element.click();
      }
    }
  }, []);

  // Global Keyboard & Remote Controller Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      lastKeyNavTimeRef.current = Date.now();
      const target = e.target as HTMLElement | null;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.getAttribute('contenteditable') === 'true';

      const isUp = e.key === 'ArrowUp' || e.keyCode === 38;
      const isDown = e.key === 'ArrowDown' || e.keyCode === 40;
      const isLeft = e.key === 'ArrowLeft' || e.keyCode === 37;
      const isRight = e.key === 'ArrowRight' || e.keyCode === 39;
      const isEnter = e.key === 'Enter' || e.keyCode === 13;
      const isBack = isBackKey(e);

      if (isInput) {
        if (isBack) {
          e.preventDefault();
          triggerBack();
          return;
        }
        if (isDown) {
          e.preventDefault();
          navigate('down');
        } else if (isRight && target instanceof HTMLInputElement) {
          if (target.selectionStart === target.value.length && target.selectionEnd === target.value.length) {
            e.preventDefault();
            navigate('right');
          }
        }
        return;
      }

      if (isBack) {
        e.preventDefault();
        triggerBack();
        return;
      }

      if (isUp) {
        e.preventDefault();
        navigate('up');
      } else if (isDown) {
        e.preventDefault();
        navigate('down');
      } else if (isLeft) {
        e.preventDefault();
        navigate('left');
      } else if (isRight) {
        e.preventDefault();
        navigate('right');
      } else if (isEnter) {
        if (focusedIdRef.current) {
          e.preventDefault();
          triggerEnter();
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (Date.now() - lastKeyNavTimeRef.current < 450) return;
      if (!lastMousePosRef.current) {
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        return;
      }
      const dx = Math.abs(e.clientX - lastMousePosRef.current.x);
      const dy = Math.abs(e.clientY - lastMousePosRef.current.y);

      if (dx > 6 || dy > 6) {
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        if (isKeyboardNavRef.current) {
          setIsKeyboardNav(false);
          if (typeof document !== 'undefined') {
            document.body.classList.remove('keyboard-nav-active');
          }
        }
      }
    };

    const handlePointerDown = () => {
      if (isKeyboardNavRef.current) {
        setIsKeyboardNav(false);
        if (typeof document !== 'undefined') {
          document.body.classList.remove('keyboard-nav-active');
        }
      }
    };

    // Samsung Tizen Hardware Key Listener
    const handleTizenHWKey = (e: Event) => {
      const customEvent = e as CustomEvent<{ keyName: string }> & { keyName?: string };
      const keyName = customEvent.keyName || customEvent.detail?.keyName;
      if (keyName === 'back') {
        triggerBack();
      }
    };

    // Browser / TV PopState Navigation Sync
    const handlePopState = () => {
      if (zoneStackRef.current.length > 1) {
        triggerBack();
      }
    };

    // Expose Android Back bridge for native Android TV wrapper
    if (typeof window !== 'undefined') {
      (window as any).handleAndroidBack = () => {
        triggerBack();
      };
      // Register Samsung Tizen remote control return key if Tizen runtime is present
      if ((window as any).tizen?.tvinputdevice?.registerKey) {
        try {
          (window as any).tizen.tvinputdevice.registerKey('Return');
        } catch {}
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('tizenhwkey', handleTizenHWKey);
    window.addEventListener('popstate', handlePopState);

    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).handleAndroidBack;
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('tizenhwkey', handleTizenHWKey);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [navigate, triggerEnter, triggerBack]);

  // Stable Actions Object (Never triggers unnecessary component re-renders)
  const actions = useMemo<SpatialNavigationActions>(
    () => ({
      register,
      unregister,
      setFocused,
      pushZone,
      popZone,
      registerZoneBack,
      triggerBack,
      navigate,
      triggerEnter,
      registerSection,
      unregisterSection,
      subscribeFocus,
      getFocusedId,
    }),
    [
      register,
      unregister,
      setFocused,
      pushZone,
      popZone,
      registerZoneBack,
      triggerBack,
      navigate,
      triggerEnter,
      registerSection,
      unregisterSection,
      subscribeFocus,
      getFocusedId,
    ]
  );

  const state = useMemo<SpatialNavigationState>(
    () => ({
      activeZone,
      isKeyboardNav,
    }),
    [activeZone, isKeyboardNav]
  );

  return (
    <SpatialNavigationActionsContext.Provider value={actions}>
      <SpatialNavigationStateContext.Provider value={state}>
        {children}
      </SpatialNavigationStateContext.Provider>
    </SpatialNavigationActionsContext.Provider>
  );
}

export function useSpatialNavigationActions() {
  const context = useContext(SpatialNavigationActionsContext);
  if (!context) {
    throw new Error('useSpatialNavigationActions must be used within a SpatialNavigationProvider');
  }
  return context;
}

export function useSpatialNavigationState() {
  const context = useContext(SpatialNavigationStateContext);
  if (!context) {
    throw new Error('useSpatialNavigationState must be used within a SpatialNavigationProvider');
  }
  return context;
}

/**
 * Unified Hook for spatial navigation actions & state
 */
export function useSpatialNavigation() {
  const actions = useSpatialNavigationActions();
  const state = useSpatialNavigationState();
  return {
    ...actions,
    ...state,
    focusedId: actions.getFocusedId(),
  };
}

export function useZoneBack(zone: string, onBack: () => void, enabled = true) {
  const { registerZoneBack } = useSpatialNavigationActions();
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  });

  useEffect(() => {
    if (!enabled) return;
    return registerZoneBack(zone, () => {
      onBackRef.current?.();
    });
  }, [zone, enabled, registerZoneBack]);
}

export interface UseFocusableOptions {
  id: string;
  zone?: string;
  section?: string;
  index?: number;
  onEnter?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
  priority?: number;
  disabled?: boolean;
}

export function useFocusable<T extends HTMLElement = HTMLDivElement>({
  id,
  zone = 'explore',
  section,
  index,
  onEnter,
  onLeft,
  onRight,
  onUp,
  onDown,
  onFocus,
  onBlur,
  autoFocus = false,
  priority = 0,
  disabled = false,
}: UseFocusableOptions) {
  const actions = useSpatialNavigationActions();
  const { activeZone, isKeyboardNav } = useSpatialNavigationState();

  const [isFocused, setIsFocused] = useState<boolean>(() => actions.getFocusedId() === id);
  const elementRef = useRef<T | null>(null);

  const onEnterRef = useRef(onEnter);
  const onLeftRef = useRef(onLeft);
  const onRightRef = useRef(onRight);
  const onUpRef = useRef(onUp);
  const onDownRef = useRef(onDown);
  const onFocusRef = useRef(onFocus);
  const onBlurRef = useRef(onBlur);

  useEffect(() => {
    onEnterRef.current = onEnter;
    onLeftRef.current = onLeft;
    onRightRef.current = onRight;
    onUpRef.current = onUp;
    onDownRef.current = onDown;
    onFocusRef.current = onFocus;
    onBlurRef.current = onBlur;
  });

  // Fine-grained subscription: only this specific component re-renders when its focus state flips
  useEffect(() => {
    return actions.subscribeFocus(id, (focused) => {
      setIsFocused(focused);
    });
  }, [id, actions]);

  useEffect(() => {
    if (disabled) {
      actions.unregister(id, elementRef.current);
      return;
    }

    const node: FocusableNode = {
      id,
      zone,
      section,
      index,
      element: elementRef.current,
      onEnter: () => onEnterRef.current?.(),
      onLeft: onLeftRef.current ? () => onLeftRef.current?.() : undefined,
      onRight: onRightRef.current ? () => onRightRef.current?.() : undefined,
      onUp: onUpRef.current ? () => onUpRef.current?.() : undefined,
      onDown: onDownRef.current ? () => onDownRef.current?.() : undefined,
      onFocus: () => onFocusRef.current?.(),
      onBlur: () => onBlurRef.current?.(),
      autoFocus,
      priority,
      disabled,
    };

    actions.register(node);

    return () => {
      actions.unregister(id, elementRef.current);
    };
  }, [id, zone, section, index, autoFocus, priority, disabled, actions]);

  const setRef = useCallback(
    (el: T | null) => {
      const prevEl = elementRef.current;
      elementRef.current = el;
      if (el && !disabled) {
        actions.register({
          id,
          zone,
          section,
          index,
          element: el,
          onEnter: () => onEnterRef.current?.(),
          onLeft: onLeftRef.current ? () => onLeftRef.current?.() : undefined,
          onRight: onRightRef.current ? () => onRightRef.current?.() : undefined,
          onUp: onUpRef.current ? () => onUpRef.current?.() : undefined,
          onDown: onDownRef.current ? () => onDownRef.current?.() : undefined,
          onFocus: () => onFocusRef.current?.(),
          onBlur: () => onBlurRef.current?.(),
          autoFocus,
          priority,
          disabled,
        });
      } else if (!el && prevEl) {
        actions.unregister(id, prevEl);
      }
    },
    [id, zone, section, index, autoFocus, priority, disabled, actions]
  );

  const focusSelf = useCallback(() => {
    actions.setFocused(id, true);
  }, [id, actions]);

  const isCurrentZoneActive = activeZone === zone;
  const isSpatialFocused = isFocused && isCurrentZoneActive && isKeyboardNav;

  return {
    ref: setRef,
    isFocused: isFocused && isCurrentZoneActive,
    isSpatialFocused,
    isKeyboardNav,
    focusSelf,
  };
}
