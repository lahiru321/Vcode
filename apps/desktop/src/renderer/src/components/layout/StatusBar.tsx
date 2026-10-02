import type { AppInfo } from '@vcode/shared';
import { invoke } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { useEffect, useState } from 'react';

export function StatusBar({ className }: { className?: string }) {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    invoke('app:getInfo').then(setInfo, (error: unknown) => {
      console.error('Failed to load app info:', error);
    });
  }, []);

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
      {info && (
        <span className="font-mono">
          v{info.version} · Electron {info.versions.electron} · Node {info.versions.node}
        </span>
      )}
    </footer>
  );
}
