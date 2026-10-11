import { SyncCoordinatorError } from '@/sync/errors';
import type { SyncCoordinatorDependencies, SyncRunIdentity, SyncSession } from '@/sync/ports';
import type { SyncPhase, SyncPublication } from '@/sync/types';

export interface SyncRunContext {
  readonly dependencies: SyncCoordinatorDependencies;
  readonly identity: SyncRunIdentity;
  readonly session: SyncSession;
}

export interface SyncStep<T> {
  readonly phase: SyncPhase;
  readonly publication?: SyncPublication;
  readonly action: () => Promise<T>;
}

export async function runSyncStep<T>(context: SyncRunContext, step: SyncStep<T>): Promise<T> {
  const publication = step.publication ?? 'not-started';
  try {
    await context.dependencies.local.markPhase({ ...context.identity, phase: step.phase, publication });
    return await step.action();
  } catch (cause) {
    if (cause instanceof SyncCoordinatorError) throw cause;
    throw new SyncCoordinatorError({ phase: step.phase, publication, cause });
  }
}

export async function failSyncRun(context: SyncRunContext, cause: unknown): Promise<never> {
  const error = cause instanceof SyncCoordinatorError ? cause
    : new SyncCoordinatorError({ phase: 'reading', publication: 'not-started', cause });
  let recorded: boolean;
  try {
    recorded = await context.dependencies.local.fail({ ...context.identity,
      phase: error.phase, publication: error.publication, failedAt: context.dependencies.now(),
      error: { name: error.name, message: error.message } });
  } catch (statusError) {
    throw new AggregateError([error, statusError], '同步失败，且未能保存失败状态');
  }
  throw error.withRecordedStatus(recorded);
}
