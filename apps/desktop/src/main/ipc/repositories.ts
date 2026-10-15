import { getDatabase } from '../db';
import { getRepository } from '../repositories/service';
import { handle } from './registry';

export function registerRepositoryHandlers(): void {
  handle('repositories:get', ({ projectId }) => getRepository(getDatabase(), projectId));
}
