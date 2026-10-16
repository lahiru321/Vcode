import { listAudit } from '../audit/service';
import { getDatabase } from '../db';
import { handle } from './registry';

export function registerAuditHandlers(): void {
  handle('audit:list', (request) => listAudit(getDatabase(), request));
}
