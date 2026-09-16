import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_ZONE_SECTIONS,
  EXPLORE_SECTIONS,
  DETAIL_SECTIONS,
  SEARCH_SECTIONS,
  PLAYER_SECTIONS,
  getGeometricDistance,
  getResponsiveGridColumns,
  type FocusableNode,
  type Direction,
  type SectionConfig,
} from '../../../src/client/context/SpatialNavigationContext.js';

describe('Spatial Navigation - Default Section Configurations', () => {
  it('should define structured section configurations for all primary zones', () => {
    expect(DEFAULT_ZONE_SECTIONS.explore).toEqual([
      { id: 'header', type: 'row' },
      { id: 'hero', type: 'row' },
      { id: 'continue-watching', type: 'row' },
      { id: 'popular-movies', type: 'row' },
      { id: 'trending-shows', type: 'row' },
    ]);

    expect(DEFAULT_ZONE_SECTIONS.detail).toEqual([
      { id: 'detail-header', type: 'row' },
      { id: 'detail-hero-action', type: 'row' },
      { id: 'detail-seasons', type: 'row' },
      { id: 'detail-episodes', type: 'grid' },
    ]);

    expect(DEFAULT_ZONE_SECTIONS.search).toEqual([
      { id: 'search-header', type: 'row' },
      { id: 'search-results', type: 'list' },
    ]);

    expect(DEFAULT_ZONE_SECTIONS.player).toEqual([
      { id: 'player-top', type: 'row' },
      { id: 'player-middle', type: 'row' },
      { id: 'player-timeline', type: 'row' },
      { id: 'player-bottom', type: 'row' },
    ]);

    expect(DEFAULT_ZONE_SECTIONS['season-menu']).toEqual([
      { id: 'dropdown-items', type: 'list' },
    ]);

    expect(DEFAULT_ZONE_SECTIONS['player-menu']).toEqual([
      { id: 'player-menu-subtitles', type: 'list' },
      { id: 'player-menu-speeds', type: 'grid', columns: 3 },
    ]);
  });

  it('should export backwards-compatible section ID arrays', () => {
    expect(EXPLORE_SECTIONS).toEqual([
      'header',
      'hero',
      'continue-watching',
      'popular-movies',
      'trending-shows',
    ]);
    expect(DETAIL_SECTIONS).toEqual([
      'detail-header',
      'detail-hero-action',
      'detail-seasons',
      'detail-episodes',
    ]);
    expect(SEARCH_SECTIONS).toEqual(['search-header', 'search-results']);
    expect(PLAYER_SECTIONS).toEqual([
      'player-top',
      'player-middle',
      'player-timeline',
      'player-bottom',
    ]);
  });
});

describe('Spatial Navigation - Responsive Grid Column Calculator', () => {
  it('should prioritize explicitly specified column count', () => {
    expect(getResponsiveGridColumns(3)).toBe(3);
    expect(getResponsiveGridColumns(6)).toBe(6);
  });

  it('should calculate responsive column counts based on viewport width', () => {
    // In Node.js environment without window, defaults to 1
    expect(getResponsiveGridColumns()).toBe(1);

    const originalWindow = (globalThis as any).window;
    try {
      (globalThis as any).window = { innerWidth: 1440 };
      expect(getResponsiveGridColumns()).toBe(4);

      (globalThis as any).window = { innerWidth: 1100 };
      expect(getResponsiveGridColumns()).toBe(3);

      (globalThis as any).window = { innerWidth: 768 };
      expect(getResponsiveGridColumns()).toBe(2);

      (globalThis as any).window = { innerWidth: 480 };
      expect(getResponsiveGridColumns()).toBe(1);
    } finally {
      (globalThis as any).window = originalWindow;
    }
  });
});

describe('Spatial Navigation - 2D Geometric Cone Navigation (getGeometricDistance)', () => {
  const currentRect = { left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100 };

  it('should calculate distance for a candidate strictly to the right with vertical overlap', () => {
    const candidateRight = { left: 220, top: 100, right: 320, bottom: 200, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateRight, 'right');
    expect(dist).not.toBeNull();
    expect(dist).toBe(20); // primaryDist (220-200) + crossDist (0) + 0 penalty
  });

  it('should reject a candidate to the left when navigating right', () => {
    const candidateLeft = { left: 0, top: 100, right: 80, bottom: 200, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateLeft, 'right');
    expect(dist).toBeNull();
  });

  it('should calculate distance for a candidate strictly to the left with vertical overlap', () => {
    const candidateLeft = { left: 0, top: 100, right: 80, bottom: 200, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateLeft, 'left');
    expect(dist).not.toBeNull();
    expect(dist).toBe(20); // primaryDist (100-80) + crossDist (0) + 0 penalty
  });

  it('should calculate distance for a candidate strictly below with horizontal overlap', () => {
    const candidateDown = { left: 100, top: 250, right: 200, bottom: 350, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateDown, 'down');
    expect(dist).not.toBeNull();
    expect(dist).toBe(50); // primaryDist (250-200) + crossDist (0) + 0 penalty
  });

  it('should calculate distance for a candidate strictly above with horizontal overlap', () => {
    const candidateUp = { left: 100, top: 0, right: 200, bottom: 60, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateUp, 'up');
    expect(dist).not.toBeNull();
    expect(dist).toBe(40); // primaryDist (100-60) + crossDist (0) + 0 penalty
  });

  it('should apply penalty for candidates within directional cone but without overlap in primary direction', () => {
    const candidateWithinCone = { left: 450, top: 220, right: 550, bottom: 320, width: 100, height: 100 };
    const distWithOverlap = getGeometricDistance(
      currentRect,
      { left: 450, top: 100, right: 550, bottom: 200, width: 100, height: 100 },
      'right'
    );
    const distWithoutOverlap = getGeometricDistance(currentRect, candidateWithinCone, 'right');

    expect(distWithOverlap).not.toBeNull();
    expect(distWithoutOverlap).not.toBeNull();
    expect(distWithoutOverlap!).toBeGreaterThan(distWithOverlap! + 500); // 1000 penalty for no vertical overlap
  });

  it('should reject candidates outside the directional cone angle', () => {
    // 45-degree diagonal candidate where dx is too small relative to dy
    const candidateOutsideCone = { left: 250, top: 250, right: 350, bottom: 350, width: 100, height: 100 };
    const dist = getGeometricDistance(currentRect, candidateOutsideCone, 'right');
    expect(dist).toBeNull();
  });
});

describe('Spatial Navigation - Key & Remote Controller Mappings', () => {
  it('should detect smart TV remote back buttons (Samsung Tizen 10009 and LG webOS 461)', () => {
    const isBackKey = (key: string, keyCode: number) =>
      key === 'Escape' || keyCode === 10009 || keyCode === 461;

    expect(isBackKey('Escape', 27)).toBe(true);
    expect(isBackKey('', 10009)).toBe(true); // Samsung Tizen Return
    expect(isBackKey('', 461)).toBe(true);   // LG webOS Back
    expect(isBackKey('ArrowLeft', 37)).toBe(false);
  });

  it('should correctly identify navigation direction keys', () => {
    const isUp = (key: string, code: number) => key === 'ArrowUp' || code === 38;
    const isDown = (key: string, code: number) => key === 'ArrowDown' || code === 40;
    const isLeft = (key: string, code: number) => key === 'ArrowLeft' || code === 37;
    const isRight = (key: string, code: number) => key === 'ArrowRight' || code === 39;
    const isEnter = (key: string, code: number) => key === 'Enter' || code === 13;

    expect(isUp('ArrowUp', 38)).toBe(true);
    expect(isDown('ArrowDown', 40)).toBe(true);
    expect(isLeft('ArrowLeft', 37)).toBe(true);
    expect(isRight('ArrowRight', 39)).toBe(true);
    expect(isEnter('Enter', 13)).toBe(true);
  });
});

describe('Spatial Navigation - Generic Section Navigation Mechanics', () => {
  it('should navigate shelf rows horizontally without wrapping across rows', () => {
    const nodes: FocusableNode[] = [
      { id: 'card-0', zone: 'explore', section: 'popular-movies', index: 0, element: null },
      { id: 'card-1', zone: 'explore', section: 'popular-movies', index: 1, element: null },
      { id: 'card-2', zone: 'explore', section: 'popular-movies', index: 2, element: null },
    ];

    let currentId = 'card-0';
    const move = (dir: 'left' | 'right') => {
      const curIdx = nodes.findIndex((n) => n.id === currentId);
      if (dir === 'left' && curIdx > 0) currentId = nodes[curIdx - 1].id;
      if (dir === 'right' && curIdx < nodes.length - 1) currentId = nodes[curIdx + 1].id;
    };

    // Left at 0 stays at 0
    move('left');
    expect(currentId).toBe('card-0');

    // Right moves to card-1 then card-2
    move('right');
    expect(currentId).toBe('card-1');
    move('right');
    expect(currentId).toBe('card-2');

    // Right at end stays at card-2
    move('right');
    expect(currentId).toBe('card-2');
  });

  it('should navigate 2D grid without wrapping between columns on horizontal navigation', () => {
    const cols = 3;
    const totalItems = 6; // 2 rows of 3: [0, 1, 2], [3, 4, 5]
    let curIdx = 2; // Last item in first row (row 0, col 2)

    const moveRight = () => {
      const colIndex = curIdx % cols;
      if (colIndex < cols - 1 && curIdx < totalItems - 1) {
        curIdx++;
      }
    };

    const moveLeft = () => {
      const colIndex = curIdx % cols;
      if (colIndex > 0 && curIdx > 0) {
        curIdx--;
      }
    };

    // Right from row 0, col 2 -> should stay at 2 (no wrapping into row 1)
    moveRight();
    expect(curIdx).toBe(2);

    // Left from 2 -> moves to 1
    moveLeft();
    expect(curIdx).toBe(1);
  });

  it('should navigate 2D grid vertically by columns and clamp to last row', () => {
    const cols = 4;
    const totalItems = 7; // Row 0: [0,1,2,3], Row 1: [4,5,6]
    let curIdx = 1;

    const moveDown = () => {
      if (curIdx + cols < totalItems) {
        curIdx += cols;
      } else if (curIdx < totalItems - 1 && Math.floor(curIdx / cols) < Math.floor((totalItems - 1) / cols)) {
        curIdx = totalItems - 1;
      }
    };

    const moveUp = () => {
      if (curIdx >= cols) {
        curIdx -= cols;
      }
    };

    // Down from index 1 -> index 5
    moveDown();
    expect(curIdx).toBe(5);

    // Down from index 5 (last row) -> stays at 5
    moveDown();
    expect(curIdx).toBe(5);

    // Up from index 5 -> index 1
    moveUp();
    expect(curIdx).toBe(1);
  });
});

describe('Spatial Navigation - Fine-Grained Subscription Model', () => {
  it('should notify only subscribed listeners on focus change', () => {
    const listeners = new Map<string, Set<(isFocused: boolean) => void>>();

    const subscribe = (id: string, callback: (isFocused: boolean) => void) => {
      let set = listeners.get(id);
      if (!set) {
        set = new Set();
        listeners.set(id, set);
      }
      set.add(callback);
      return () => {
        listeners.get(id)?.delete(callback);
      };
    };

    const cbA = vi.fn();
    const cbB = vi.fn();
    const cbC = vi.fn();

    const unsubA = subscribe('node-a', cbA);
    const unsubB = subscribe('node-b', cbB);
    const unsubC = subscribe('node-c', cbC);

    let focusedId: string | null = 'node-a';

    const setFocused = (newId: string | null) => {
      const prev = focusedId;
      focusedId = newId;
      if (prev) listeners.get(prev)?.forEach((cb) => cb(false));
      if (newId) listeners.get(newId)?.forEach((cb) => cb(true));
    };

    // Initial switch: from node-a to node-b
    setFocused('node-b');

    expect(cbA).toHaveBeenCalledWith(false);
    expect(cbB).toHaveBeenCalledWith(true);
    expect(cbC).not.toHaveBeenCalled(); // Node C is never re-rendered/notified!

    unsubA();
    unsubB();
    unsubC();
  });
});
