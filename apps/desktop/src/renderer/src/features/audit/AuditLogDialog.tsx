import type { AuditEntry } from '@vcode/shared';
import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { NativeOption, NativeSelect } from '@renderer/components/ui/native-select';
import { useProjects } from '@renderer/features/projects/ProjectsProvider';
import { errorMessage, FormError } from '@renderer/lib/form';
import { invoke } from '@renderer/lib/ipc';
import { describeAudit } from './describe';

// The audit log viewer (P7-05): newest first, for every project or one.

const PAGE = 100;
const ALL = '';

interface AuditLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AuditLogDialog({ open, onClose }: AuditLogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Audit log</DialogTitle>
          <DialogDescription>
            Terminals and agents started and stopped, and changes to agents, API keys, workspaces
            and projects. API keys themselves are never recorded.
          </DialogDescription>
        </DialogHeader>
        {open && <AuditLog />}
      </DialogContent>
    </Dialog>
  );
}

function AuditLog() {
  const ids = useId();
  const { projects } = useProjects();
  const [projectId, setProjectId] = useState(ALL);
  const [state, setState] = useState<{
    for: string;
    entries: AuditEntry[];
    hasMore: boolean;
  } | null>(null);
  const [error, setError] = useState<{ for: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  /** A page of `filter`'s entries: the first, or the one after `after`. */
  const fetchPage = useCallback(
    (filter: string, after?: string) =>
      invoke('audit:list', {
        ...(filter ? { projectId: filter } : {}),
        ...(after ? { after } : {}),
        limit: PAGE,
      }).then(
        (page) => {
          setError(null);
          setState((current) => ({
            for: filter,
            entries:
              after && current?.for === filter
                ? [...current.entries, ...page.entries]
                : page.entries,
            hasMore: page.hasMore,
          }));
        },
        (err: unknown) => setError({ for: filter, message: errorMessage(err) }),
      ),
    [],
  );

  useEffect(() => {
    void fetchPage(projectId);
  }, [fetchPage, projectId]);

  const loadMore = (after: string) => {
    setLoadingMore(true);
    void fetchPage(projectId, after).finally(() => setLoadingMore(false));
  };

  const loading = state?.for !== projectId && error?.for !== projectId;
  const entries = state?.for === projectId ? state.entries : [];
  const last = entries.at(-1);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label htmlFor={`${ids}-project`} className="text-sm text-muted-foreground">
          Project
        </label>
        <NativeSelect
          id={`${ids}-project`}
          className="w-56"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          <NativeOption value={ALL}>All projects</NativeOption>
          {projects.map((project) => (
            <NativeOption key={project.id} value={project.id}>
              {project.name}
            </NativeOption>
          ))}
        </NativeSelect>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {entries.length === 0 && !loading ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ol className="divide-y text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="grid grid-cols-[9.5rem_1fr] gap-3 px-3 py-2">
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  className="font-mono text-xs text-muted-foreground tabular-nums"
                >
                  {new Date(entry.createdAt).toLocaleString()}
                </time>
                <div className="min-w-0">
                  <div className="break-words">{describeAudit(entry)}</div>
                  <div className="truncate text-xs text-muted-foreground" title={details(entry)}>
                    {entry.projectName ?? 'App'} · {details(entry)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <FormError message={error?.for === projectId ? error.message : null} />
      {state?.for === projectId && state.hasMore && last && (
        <Button
          variant="outline"
          size="sm"
          className="self-center"
          disabled={loadingMore}
          onClick={() => loadMore(last.id)}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

/** The recorded facts, e.g. "path: C:\shop · branch: main". */
function details(entry: AuditEntry): string {
  return Object.entries(entry.metadata)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' · ');
}
