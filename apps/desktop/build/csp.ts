import type { Plugin } from 'vite';

/**
 * Content-Security-Policy for the renderer, injected as a <meta> tag so it applies to both
 * the Vite dev server and the packaged file:// build. Spec: V1 doc §21.
 *
 * - Scripts: only bundled files. Dev additionally allows inline scripts, which Vite's React
 *   Fast Refresh preamble needs.
 * - Styles: 'unsafe-inline' is required because Radix and xterm.js inject <style> elements.
 * - Network: nothing outside the app, except the Vite HMR WebSocket in dev.
 */
function buildPolicy(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': ["'self'", ...(isDev ? ["'unsafe-inline'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(isDev ? ['ws://localhost:*', 'http://localhost:*'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  };

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

export function contentSecurityPolicy(): Plugin {
  let isDev = false;

  return {
    name: 'agent-hub:csp',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildPolicy(isDev) },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
