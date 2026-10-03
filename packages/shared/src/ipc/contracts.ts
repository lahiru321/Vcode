import { z } from 'zod';
import { PROJECT_STATUSES } from '../domain';
import type { EventChannel, InvokeChannel } from './channels';

// One contract per channel. Main validates every request and response against these, and
// every event payload before sending it. Spec: V1 doc §20 (IPC design).
//
// Response schemas are z.object (strips unknown keys), so fields a service adds by mistake —
// e.g. secrets — never reach the renderer. Request schemas are strict: unknown keys are an error.

const NoPayload = z.undefined();
const Id = z.uuid();
const Timestamp = z.number().int().nonnegative();

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

// Projects (V1 doc §20). Deleting a project removes its records, never files on disk.

const ProjectName = z.string().trim().min(1, 'Name is required').max(100, 'Name is too long');

export const Project = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
  rootPath: z.string(),
  defaultBranch: z.string().nullable(),
  status: z.enum(PROJECT_STATUSES),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Project = z.infer<typeof Project>;

export const ProjectIdRequest = z.strictObject({ id: Id });

export const CreateProjectRequest = z.strictObject({
  /** An existing folder. Main resolves it to its real path. */
  rootPath: z.string().trim().min(1, 'Folder is required').max(4096),
  /** Defaults to the folder name. */
  name: ProjectName.optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z
  .strictObject({
    id: Id,
    name: ProjectName.optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((request) => request.name !== undefined || request.status !== undefined, {
    message: 'Nothing to update',
  });
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

// Settings the renderer may read and change (V1 doc §20). Each key is one `app_settings` row;
// main falls back to the default when a row is missing or no longer matches its schema.
// Main-only state (e.g. window bounds) lives in the same table but is never exposed here.

export const Settings = z.object({
  /** The project shown in the main area; restored on the next launch. */
  selectedProjectId: Id.nullable(),
});
export type Settings = z.infer<typeof Settings>;
export type SettingKey = keyof Settings;

export const SETTING_DEFAULTS: Settings = {
  selectedProjectId: null,
};

/** Only the given keys are changed. */
export const SetSettingsRequest = z
  .strictObject(Settings.shape)
  .partial()
  .refine((request) => Object.keys(request).length > 0, { message: 'Nothing to update' });

/** `path` is null when the user cancels the dialog. */
export const PickFolderResponse = z.object({ path: z.string().nullable() });

export const invokeContracts = {
  'app:getInfo': { request: NoPayload, response: AppInfo },
  'projects:list': { request: NoPayload, response: z.array(Project) },
  'projects:get': { request: ProjectIdRequest, response: Project },
  'projects:create': { request: CreateProjectRequest, response: Project },
  'projects:update': { request: UpdateProjectRequest, response: Project },
  'projects:delete': { request: ProjectIdRequest, response: z.object({ id: Id }) },
  'settings:get': { request: NoPayload, response: Settings },
  'settings:set': { request: SetSettingsRequest, response: Settings },
  'dialog:pickFolder': { request: NoPayload, response: PickFolderResponse },
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
