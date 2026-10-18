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
    context.dependencies.reportProgress?.({ phase: syncPhaseLabel(step.phase), totalBytes: undefined });
    await context.dependencies.local.markPhase({ ...context.identity, phase: step.phase, publication });
    return await step.action();
  } catch (cause) {
    if (cause instanceof SyncCoordinatorError) throw cause;
    throw new SyncCoordinatorError({ phase: step.phase, publication, cause });
  }
}

function syncPhaseLabel(phase: SyncPhase): string {
  const labels: Record<SyncPhase, string> = {
    reading: '读取同步快照', merging: '合并本机与远端数据', 'receiving-media': '检查并接收媒体',
    applying: '事务应用到本机', 'uploading-media': '上传加密媒体', publishing: '发布同步快照', complete: '完成同步',
  };
  return labels[phase];
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
