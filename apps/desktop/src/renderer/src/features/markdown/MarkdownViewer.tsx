import { IpcError, type MarkdownFile, type Project } from '@vcode/shared';
import { FileText, FolderOpen, ImageOff, RotateCw, X } from 'lucide-react';
import {
  Children,
  createContext,
  isValidElement,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Button } from '@renderer/components/ui/button';
import { invoke } from '@renderer/lib/ipc';
import { displayPath, folderOf, headingId, isMarkdownPath } from './paths';

// A reading pane beside the terminal grid for the project's Markdown files: plans, READMEs and
// notes that agents write. Files open from the header's button, from Markdown paths printed in a
// terminal, and from links in the file on screen. It follows changes to the file on disk.

/** Opens a Markdown file in the pane: picked in a dialog, or `path` (relative to `baseDir`). */
export type OpenMarkdown = (path?: string, baseDir?: string) => void;

const MarkdownViewerContext = createContext<OpenMarkdown | null>(null);
export const MarkdownViewerProvider = MarkdownViewerContext;

/** The project's `OpenMarkdown`, or null outside a project. */
export function useOpenMarkdown(): OpenMarkdown | null {
  return use(MarkdownViewerContext);
}

/** How often the open file is checked for changes, while the window is visible. */
const REFRESH_MS = 2_000;

export interface MarkdownViewer {
  file: MarkdownFile | null;
  open: OpenMarkdown;
  reload: () => void;
  close: () => void;
}

export function useMarkdownViewer(project: Project): MarkdownViewer {
  const [file, setFile] = useState<MarkdownFile | null>(null);
  const projectId = project.id;

  const open = useCallback<OpenMarkdown>(
    (path, baseDir) => {
      invoke('markdown:open', { projectId, path, baseDir }).then(
        (opened) => opened && setFile(opened),
        (error: unknown) =>
          toast.error("Couldn't open the file", {
            description: error instanceof Error ? error.message : String(error),
          }),
      );
    },
    [projectId],
  );

  // Re-read while it's open; only a newer version replaces what's on screen.
  const path = file?.path;
  const read = useCallback(
    (quiet: boolean) => {
      if (!path) return;
      invoke('markdown:open', { projectId, path }).then(
        (latest) =>
          latest &&
          setFile((current) =>
            current?.path === latest.path && current.modifiedAt === latest.modifiedAt && quiet
              ? current
              : latest,
          ),
        (error: unknown) => {
          if (quiet) return;
          toast.error(
            error instanceof IpcError && error.code === 'NOT_FOUND'
              ? 'The file is gone. It may have been moved or deleted.'
              : "Couldn't reload the file",
          );
        },
      );
    },
    [projectId, path],
  );

  useEffect(() => {
    if (!path) return;
    const timer = window.setInterval(() => !document.hidden && read(true), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [path, read]);

  return { file, open, reload: () => read(false), close: () => setFile(null) };
}

const WIDTH_KEY = 'vcode.markdownPaneWidth';
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 560;

function savedWidth(): number {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY));
    return width >= MIN_WIDTH ? width : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/** The pane's width, dragged from its left edge and remembered between sessions. */
function usePaneWidth(): [number, (event: PointerEvent<HTMLDivElement>) => void] {
  const [width, setWidth] = useState(savedWidth);
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    // The terminals keep at least this much room.
    const max = Math.max(MIN_WIDTH, (handle.parentElement?.parentElement?.clientWidth ?? 0) - 320);
    let latest = startWidth;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => {
      latest = Math.min(max, Math.max(MIN_WIDTH, startWidth + startX - e.clientX));
      setWidth(latest);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(WIDTH_KEY, String(Math.round(latest)));
      } catch {
        // Not remembered; the pane still works.
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  return [width, startResize];
}

/** The plain text of rendered children, for heading anchors. */
function textOf(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      typeof child === 'string' || typeof child === 'number'
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : '',
    )
    .join('');
}

function heading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  return function Heading({
    children,
    node: _node,
    ...props
  }: ComponentProps<'h1'> & { node?: unknown }) {
    return (
      <Tag id={headingId(textOf(children))} {...props}>
        {children}
      </Tag>
    );
  };
}

export function MarkdownPane({ project, viewer }: { project: Project; viewer: MarkdownViewer }) {
  const [width, startResize] = usePaneWidth();
  const articleRef = useRef<HTMLElement>(null);
  const { file, open, reload, close } = viewer;

  // A new file starts at the top.
  const path = file?.path;
  useEffect(() => {
    articleRef.current?.parentElement?.scrollTo({ top: 0 });
  }, [path]);

  if (!file) return null;

  const followLink = (href: string) => {
    if (href.startsWith('#')) {
      const target = articleRef.current?.querySelector(
        `#${CSS.escape(decodeURIComponent(href.slice(1)))}`,
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (/^[a-z][\w+.-]*:/i.test(href)) {
      // main asks before opening http(s) links in the browser and refuses anything else.
      window.open(href);
      return;
    }
    const target = decodeURIComponent(href.replace(/[?#].*$/, ''));
    if (isMarkdownPath(target)) {
      open(target, folderOf(file.path));
    } else {
      toast.info('Only Markdown files open here.', { description: target });
    }
  };

  const components: Components = {
    a: ({ href, children, node: _node, ...props }) => (
      <a
        {...props}
        href={href}
        title={href}
        onClick={(event) => {
          event.preventDefault();
          if (href) followLink(href);
        }}
      >
        {children}
      </a>
    ),
    // Images aren't loaded: the page may only show its own files (V1 doc §21).
    img: ({ alt }) => (
      <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
        <ImageOff className="size-3" />
        {alt || 'image'}
      </span>
    ),
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
  };

  const shown = displayPath(project.rootPath, file.path);
  return (
    <aside
      className="relative flex min-h-0 shrink-0 flex-col border-l bg-background"
      style={{ width }}
      aria-label="Markdown viewer"
    >
      <div
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-ring/30"
        onPointerDown={startResize}
        title="Drag to resize"
      />
      <div className="flex h-8 shrink-0 items-center gap-1 border-b pr-1 pl-3">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={file.path}>
          {shown}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          title="Open another Markdown file"
          onClick={() => open()}
        >
          <FolderOpen />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Reload" onClick={reload}>
          <RotateCw />
        </Button>
        <Button size="icon-xs" variant="ghost" title="Close" onClick={close}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <article ref={articleRef} className="markdown-body select-text px-6 py-5">
          <Markdown remarkPlugins={[remarkGfm]} components={components}>
            {file.content}
          </Markdown>
        </article>
      </div>
    </aside>
  );
}
