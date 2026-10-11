import type { SyncPhase, SyncPublication } from '@/sync/types';

const PHASE_NAMES: Readonly<Record<SyncPhase, string>> = {
  reading: '读取快照', merging: '合并', 'receiving-media': '接收媒体', applying: '本机事务',
  'uploading-media': '上传媒体', publishing: '发布快照', complete: '记录同步结果',
};

interface SyncCoordinatorErrorInput {
  readonly phase: SyncPhase;
  readonly publication: SyncPublication;
  readonly cause: unknown;
  readonly statusRecorded?: boolean;
}

export class SyncCoordinatorError extends Error {
  readonly phase: SyncPhase;
  readonly publication: SyncPublication;
  readonly statusRecorded: boolean;

  constructor(input: SyncCoordinatorErrorInput) {
    const reason = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(`同步在${PHASE_NAMES[input.phase]}阶段失败：${reason}`, { cause: input.cause });
    this.name = 'SyncCoordinatorError';
    this.phase = input.phase;
    this.publication = input.publication;
    this.statusRecorded = input.statusRecorded ?? false;
  }

  withRecordedStatus(statusRecorded: boolean): SyncCoordinatorError {
    return new SyncCoordinatorError({ phase: this.phase, publication: this.publication, cause: this.cause, statusRecorded });
  }
}
