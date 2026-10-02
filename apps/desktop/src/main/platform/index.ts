import { darwin } from './darwin';
import type { Platform } from './types';
import { win32 } from './win32';

export type { Command, Environment, Executable, ExecutableKind, Platform } from './types';
export { toEnvironment } from './common';

// The one place that branches on the OS. ESLint bans process.platform everywhere else.
// Linux isn't a target; it gets the macOS (POSIX) implementation.
export const platform: Platform = process.platform === 'win32' ? win32 : darwin;
