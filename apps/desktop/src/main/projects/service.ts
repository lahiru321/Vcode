import { basename } from 'node:path';
import {
  IpcError,
  type CreateProjectRequest,
  type ProjectStatus,
  type UpdateProjectRequest,
} from '@vcode/shared';
import { eq, like, or, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { projects } from '../db/schema';
import { resolveExistingFolder } from '../fs/folders';
import { detectGitRepository } from '../git/detect';

// Project CRUD (V1 doc §18 "projects"). Functions take the database so tests can pass their own.

export type ProjectRow = typeof projects.$inferSelect;
type Queryable = Pick<AppDatabase, 'select'>;

const MAX_NAME_LENGTH = 100;
const MAX_SLUG_LENGTH = 48;

/** "My Shop (v2)" → "my-shop-v2". Accents are dropped; anything else non-alphanumeric is a dash. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

/** `slugify(name)`, with -2, -3, … appended if another project already uses it. */
function uniqueSlug(db: Queryable, name: string): string {
  const base = slugify(name);
  const taken = new Set(
    db
      .select({ slug: projects.slug })
      .from(projects)
      .where(or(eq(projects.slug, base), like(projects.slug, `${base}-%`)))
      .all()
      .map((row) => row.slug),
  );
  let slug = base;
  for (let n = 2; taken.has(slug); n++) {
    slug = `${base}-${n}`;
  }
  return slug;
}

export function listProjects(db: AppDatabase): ProjectRow[] {
  return db
    .select()
    .from(projects)
    .orderBy(sql`${projects.name} collate nocase`, projects.createdAt)
    .all();
}

export function getProject(db: AppDatabase, id: string): ProjectRow {
  const project = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) {
    throw new IpcError('NOT_FOUND', 'Project not found. It may have been deleted.');
  }
  return project;
}

export async function createProject(
  db: AppDatabase,
  request: CreateProjectRequest,
): Promise<ProjectRow> {
  const rootPath = await resolveExistingFolder(request.rootPath);
  const git = await detectGitRepository(rootPath);
  const name = (request.name ?? basename(rootPath)).slice(0, MAX_NAME_LENGTH);

  // Synchronous transaction: the duplicate check and the insert can't interleave with
  // another create.
  return db.transaction((tx) => {
    const existing = tx
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.rootPath, rootPath))
      .get();
    if (existing) {
      throw new IpcError('CONFLICT', `This folder is already the project “${existing.name}”.`);
    }
    return tx
      .insert(projects)
      .values({
        name,
        slug: uniqueSlug(tx, name),
        rootPath,
        defaultBranch: git?.defaultBranch ?? null,
      })
      .returning()
      .get();
  });
}

/** Renames or archives a project. The folder and slug never change. */
export function updateProject(db: AppDatabase, request: UpdateProjectRequest): ProjectRow {
  getProject(db, request.id);
  const changes: { name?: string; status?: ProjectStatus } = {};
  if (request.name !== undefined) changes.name = request.name;
  if (request.status !== undefined) changes.status = request.status;

  return db.update(projects).set(changes).where(eq(projects.id, request.id)).returning().get()!;
}

/**
 * Removes the project and, through foreign-key cascades, its repositories, workspaces,
 * project agents and sessions. Files on disk are never touched.
 */
export function deleteProject(db: AppDatabase, id: string): { id: string } {
  getProject(db, id);
  db.delete(projects).where(eq(projects.id, id)).run();
  return { id };
}
