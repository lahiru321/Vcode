import { AppShell } from '@renderer/components/layout/AppShell';
import { useShortcutListener } from '@renderer/lib/shortcuts';

export function App() {
  useShortcutListener();
  return <AppShell />;
}
