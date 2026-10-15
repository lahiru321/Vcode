import { ArrowDown, ArrowUp, CaseSensitive, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import type { SearchQuery, SearchResults, TerminalControls } from './TerminalView';

// Find in a terminal's output and scrollback (P5-04), over the panel's top-right corner like
// VS Code's find widget. Enter: next match, Shift+Enter: previous, Escape: close.

function resultsLabel(term: string, results: SearchResults | null): string {
  if (!term) return '';
  if (!results || results.count === 0) return 'No results';
  if (results.index < 0) return `${results.count}+ matches`;
  return `${results.index + 1} of ${results.count}`;
}

export function TerminalSearch({
  controls,
  onClose,
}: {
  controls: TerminalControls;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => controls.onSearchResults(setResults), [controls]);
  // Focus after the terminal, which takes focus a frame after its panel becomes active.
  useEffect(() => {
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => controls.clearSearch(), [controls]);

  const find = (backwards: boolean, query: SearchQuery = { term, caseSensitive }) => {
    if (!query.term) {
      controls.clearSearch();
      setResults(null);
      return;
    }
    if (backwards) controls.findPrevious(query);
    else controls.findNext(query);
  };

  const close = () => {
    onClose();
    controls.focus();
  };

  return (
    <div
      role="search"
      className="absolute top-1 right-3 z-10 flex items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md"
      // Keep keys away from the terminal and dockview.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        ref={input}
        aria-label="Find in terminal"
        placeholder="Find"
        value={term}
        spellCheck={false}
        onChange={(event) => {
          setTerm(event.target.value);
          find(false, { term: event.target.value, caseSensitive, incremental: true });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            find(event.shiftKey);
          } else if (event.key === 'Escape') {
            close();
          }
        }}
        className="h-6 w-44 rounded-sm bg-transparent px-1.5 text-xs outline-none placeholder:text-muted-foreground"
      />
      <span
        className="min-w-16 px-1 text-right text-xs text-muted-foreground tabular-nums"
        aria-live="polite"
      >
        {resultsLabel(term, results)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        className={cn('size-6', caseSensitive && 'bg-accent text-accent-foreground')}
        aria-label="Match case"
        aria-pressed={caseSensitive}
        title="Match case"
        onClick={() => {
          setCaseSensitive(!caseSensitive);
          find(false, { term, caseSensitive: !caseSensitive });
          input.current?.focus();
        }}
      >
        <CaseSensitive />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!term}
        onClick={() => find(true)}
      >
        <ArrowUp />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!term}
        onClick={() => find(false)}
      >
        <ArrowDown />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        aria-label="Close find"
        title="Close (Escape)"
        onClick={close}
      >
        <X />
      </Button>
    </div>
  );
}
