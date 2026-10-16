import type { DockviewApi } from 'dockview-react';
import { useEffect } from 'react';

// "Show this terminal" from outside the grid (a notification click, P7-03). The project may
// still be switching and its grid not built yet, so the request waits until a grid that has the
// terminal's panel picks it up.

let pending: string | null = null;
const grids = new Set<() => void>();

export function requestTerminalFocus(terminalId: string): void {
  pending = terminalId;
  for (const check of grids) check();
}

/** Lets this grid take a pending request: whenever it's ready and whenever its panels change. */
export function useTerminalFocus(api: DockviewApi | null, panelsVersion: unknown): void {
  useEffect(() => {
    if (!api) return;
    const check = () => {
      const panel = pending ? api.getPanel(pending) : undefined;
      if (!panel) return;
      pending = null;
      // A maximized group hides the others.
      if (api.hasMaximizedGroup() && !panel.group.api.isMaximized()) api.exitMaximizedGroup();
      panel.api.setActive();
    };
    check();
    grids.add(check);
    return () => void grids.delete(check);
  }, [api, panelsVersion]);
}
