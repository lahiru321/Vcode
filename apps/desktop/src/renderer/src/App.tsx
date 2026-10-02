import { APP_NAME } from '@agent-hub/shared';

export function App() {
  const { versions } = window.agentHub;

  return (
    <main className="app">
      <h1>{APP_NAME}</h1>
      <p className="muted">Desktop shell is running.</p>
      <dl className="versions">
        <dt>Electron</dt>
        <dd>{versions.electron}</dd>
        <dt>Chromium</dt>
        <dd>{versions.chrome}</dd>
        <dt>Node.js</dt>
        <dd>{versions.node}</dd>
      </dl>
    </main>
  );
}
