import type { VcodeApi } from '../../preload';

declare global {
  interface Window {
    vcode: VcodeApi;
  }
}
