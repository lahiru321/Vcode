import type { AppInfo } from '@vcode/shared';
import { useEffect, useState } from 'react';
import { invoke } from './ipc';

let request: Promise<AppInfo> | null = null;

/** `app:getInfo`, asked once and shared; null until it answers (or if it fails). */
export function useAppInfo(): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    request ??= invoke('app:getInfo');
    request.then(
      (answer) => !cancelled && setInfo(answer),
      () => {
        request = null;
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return info;
}
