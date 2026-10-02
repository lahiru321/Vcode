import { cn } from '@renderer/lib/utils';

export function StatusBar({ className }: { className?: string }) {
  const { versions } = window.agentHub;

  return (
    <footer
      className={cn(
        'flex h-6 items-center justify-between border-t bg-sidebar px-3 text-[11px] text-muted-foreground',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-success" />
        Ready · 0 agents running
      </span>
      <span className="font-mono">
        Electron {versions.electron} · Node {versions.node}
      </span>
    </footer>
  );
}
