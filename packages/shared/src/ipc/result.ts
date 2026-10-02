// Errors thrown across contextBridge lose everything but their message, so main returns a
// result envelope instead of throwing, and the renderer unwraps it.

export const IPC_ERROR_CODES = [
  'FORBIDDEN_SENDER',
  'UNKNOWN_CHANNEL',
  'INVALID_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL',
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export interface IpcErrorInfo {
  code: IpcErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorInfo };

/** Throw from a main-process handler to send a specific error code to the renderer. */
export class IpcError extends Error {
  override readonly name = 'IpcError';

  constructor(
    readonly code: IpcErrorCode,
    message: string,
  ) {
    super(message);
  }
}
