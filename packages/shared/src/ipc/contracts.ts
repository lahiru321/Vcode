import { z } from 'zod';
import type { EventChannel, InvokeChannel } from './channels';

// One contract per channel. Main validates every request and response against these, and
// every event payload before sending it. Spec: V1 doc §20 (IPC design).
//
// Response schemas are z.object (strips unknown keys), so fields a service adds by mistake —
// e.g. secrets — never reach the renderer.

const NoPayload = z.undefined();

export const AppInfo = z.object({
  name: z.string(),
  version: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  }),
});
export type AppInfo = z.infer<typeof AppInfo>;

export const AppNotice = z.object({
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
});
export type AppNotice = z.infer<typeof AppNotice>;

export const invokeContracts = {
  'app:getInfo': { request: NoPayload, response: AppInfo },
} satisfies Record<InvokeChannel, { request: z.ZodType; response: z.ZodType }>;

export const eventContracts = {
  'app:notice': AppNotice,
} satisfies Record<EventChannel, z.ZodType>;

export type InvokeRequest<C extends InvokeChannel> = z.input<
  (typeof invokeContracts)[C]['request']
>;
export type InvokeResponse<C extends InvokeChannel> = z.output<
  (typeof invokeContracts)[C]['response']
>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

/** Arguments after the channel name: none for channels without a payload. */
export type InvokeArgs<C extends InvokeChannel> =
  InvokeRequest<C> extends undefined ? [] : [request: InvokeRequest<C>];
