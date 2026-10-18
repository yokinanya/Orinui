import { useMemo, useState } from 'react';
import type { S3Credentials } from '@/domain/s3-configuration';
import type { S3ConnectionPlan, S3ResetTarget, S3SyncStatus } from '@/sync/s3-types';
import type { SyncProgressReporter, SyncSizePreview } from '@/sync/ports';
import { S3RecoveryRequiredError } from '@/sync/s3-recovery-required';
import type { S3SyncService } from '@/sync/s3-types';
import type { OperationValue } from '@/app/operations';
import type { S3SyncContextValue } from '@/app/s3-sync-context';
import { checkS3Permission, requestS3Permission } from '@/platform/s3-settings';

export type S3OperationRunner = (label: string, action: (progress: SyncProgressReporter) => Promise<void>,
  refreshDataAfter?: boolean) => Promise<boolean>;

interface S3ActionInput {
  readonly service: S3SyncService;
  readonly operations: OperationValue;
  readonly status: S3SyncStatus | null;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
  readonly run: S3OperationRunner;
}

interface S3PlanState {
  readonly plan: S3ConnectionPlan | null;
  readonly recoveryTarget: S3ResetTarget | null;
  readonly sizePreview: SyncSizePreview | null;
  readonly setPlan: (plan: S3ConnectionPlan | null) => void;
  readonly setRecoveryTarget: (target: S3ResetTarget | null) => void;
  readonly setSizePreview: (preview: SyncSizePreview | null) => void;
}

function useS3PlanState() {
  const [plan, setPlan] = useState<S3ConnectionPlan | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<S3ResetTarget | null>(null);
  const [sizePreview, setSizePreview] = useState<SyncSizePreview | null>(null);
  return { plan, recoveryTarget, sizePreview, setPlan, setRecoveryTarget, setSizePreview };
}

function useS3PlanActions(input: S3ActionInput, state: S3PlanState) {
  const prepare = async (credentials: S3Credentials, recoveryKey?: string) => {
    input.setError(null); state.setPlan(null); state.setRecoveryTarget(null);
    const task = input.operations.begin('检查 S3 连接', '申请来源权限并检查 bucket');
    try {
      const plan = await input.service.prepare({ credentials, ...(recoveryKey ? { recoveryKey } : {}) });
      state.setPlan(plan);
      task.succeed(`检查完成：${plan.mode === 'create' ? '创建同步库' : '加入现有同步库'}`);
      return true;
    } catch (cause) {
      if (cause instanceof S3RecoveryRequiredError) state.setRecoveryTarget(cause.target);
      task.fail(cause); input.setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const connect = async () => {
    if (!state.plan) { input.setError('请先检查 S3 连接'); return false; }
    const succeeded = await input.run('连接 S3 同步', (progress) => input.service.connect(progress), true);
    if (succeeded) { state.setPlan(null); state.setRecoveryTarget(null); }
    return succeeded;
  };
  return { prepare, connect, cancelPlan: () => {
    input.service.cancelPlan(); state.setPlan(null); state.setRecoveryTarget(null); input.setError(null);
  } };
}

function useS3RemoteActions(input: S3ActionInput, state: S3PlanState) {
  const syncNow = () => input.run('同步 S3 数据', async (progress) => {
    if (input.status) await checkS3Permission(input.status.endpoint);
    await input.service.syncNow(progress);
  }, true);
  const previewSizes = () => {
    state.setSizePreview(null);
    return input.run('预览 S3 同步容量', async (progress) => {
      state.setSizePreview(await input.service.previewSizes(progress));
    });
  };
  const disconnect = () => input.run('断开 S3 同步', () => input.service.disconnect());
  const deleteRemote = () => input.run('删除 S3 远端同步库', async () => {
    if (!input.status) throw new Error('S3 同步尚未连接');
    await requestS3Permission(input.status.endpoint);
    await input.service.deleteRemote();
  });
  const resetRemote = () => resetS3Remote(input, state);
  return { syncNow, previewSizes, disconnect, deleteRemote, resetRemote };
}

async function resetS3Remote(input: S3ActionInput, state: S3PlanState): Promise<boolean> {
  const target = state.recoveryTarget;
  if (!target) { input.setError('请重新检查待重置的 S3 同步库'); return false; }
  const succeeded = await input.run('忘记密钥并删除 S3 同步库', async () => {
    await requestS3Permission(target.configuration.credentials.endpoint);
    await input.service.resetRemote(target);
  });
  if (succeeded) { state.setPlan(null); state.setRecoveryTarget(null); }
  return succeeded;
}

export function useS3Actions(input: S3ActionInput): S3SyncContextValue {
  const state = useS3PlanState();
  const planActions = useS3PlanActions(input, state);
  const remoteActions = useS3RemoteActions(input, state);
  return useMemo(() => ({ ...input, ...state, ...planActions, ...remoteActions }),
    [input, state, planActions, remoteActions]);
}
