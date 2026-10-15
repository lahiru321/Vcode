import { IpcError } from '@vcode/shared';
import { and, eq } from 'drizzle-orm';
import type { AppDatabase } from '../db';
import { projects, repositories, workspaces } from '../db/schema';
import { detectGitRepository, type GitInfo } from '../git/detect';

// Repositories (V1 doc §8, §18 "repositories"): the Git repository at a project's root, if there
// is one. One row per project. Detected from the `.git` files (git/detect.ts), never by running
// `git`, and again on every `repositories:get`, since a folder can become a repository (or stop
// being one) after it was added.

export type RepositoryRow = typeof repositories.$inferSelect;
type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

/**
 * Brings the project's records in line with `git` (null = not a repository): its repository row,
 * its default branch, and its `main` workspace's repository and checked-out branch. Call inside
 * a transaction.
 */
export function recordGitInfo(
  tx: Transaction,
  project: { id: string; rootPath: string; defaultBranch: string | null },
  git: GitInfo | null,
): RepositoryRow | null {
  const existing = tx
    .select()
    .from(repositories)
    .where(eq(repositories.projectId, project.id))
    .get();

  let repository: RepositoryRow | null = null;
  if (!git) {
    tx.delete(repositories).where(eq(repositories.projectId, project.id)).run();
  } else {
    const values = {
      remoteUrl: git.remoteUrl,
      localPath: project.rootPath,
      defaultBranch: git.defaultBranch,
    };
    repository = existing
      ? tx
          .update(repositories)
          .set(values)
          .where(eq(repositories.id, existing.id))
          .returning()
          .get()!
      : tx
          .insert(repositories)
          .values({ projectId: project.id, ...values })
          .returning()
          .get();
  }

  const defaultBranch = git?.defaultBranch ?? null;
  if (defaultBranch !== project.defaultBranch) {
    tx.update(projects).set({ defaultBranch }).where(eq(projects.id, project.id)).run();
  }
  tx.update(workspaces)
    .set({ repositoryId: repository?.id ?? null, branch: git?.branch ?? null })
    .where(and(eq(workspaces.projectId, project.id), eq(workspaces.kind, 'main')))
    .run();
  return repository;
}

/** The project's repository, detected again now; null if its folder isn't a Git repository. */
export async function getRepository(
  db: AppDatabase,
  projectId: string,
): Promise<RepositoryRow | null> {
  const before = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!before) {
    throw new IpcError('NOT_FOUND', 'Project not found. It may have been deleted.');
  }
  const git = await detectGitRepository(before.rootPath);
  return db.transaction((tx) => {
    // Read again: the project may have changed or gone while the files were read.
    const project = tx.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) {
      throw new IpcError('NOT_FOUND', 'Project not found. It may have been deleted.');
    }
    return recordGitInfo(tx, project, git);
  });
}
