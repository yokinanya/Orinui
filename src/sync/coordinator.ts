import type { SyncSnapshot } from '@/domain/sync';
import { SyncCoordinatorError } from '@/sync/errors';
import { prepareSyncMedia, uploadSyncMedia } from '@/sync/media';
import type { SyncCoordinatorDependencies, SyncLocalExport } from '@/sync/ports';
import { publishSyncSnapshot } from '@/sync/publish';
import { readRemoteSnapshots, type RemoteSnapshots } from '@/sync/read-snapshots';
import { failSyncRun, runSyncStep, type SyncRunContext } from '@/sync/run-context';
import type { SyncRunResult } from '@/sync/types';
import type { SyncProgressReporter, SyncSizePreview } from '@/sync/ports';
import { previewSyncSize } from '@/sync/preview';
import { validateObjectIdentity } from '@/domain/sync/object-validation';

export interface SyncCoordinator {
  syncNow(): Promise<SyncRunResult>;
  previewSizes(reportProgress?: SyncProgressReporter): Promise<SyncSizePreview>;
}

function mergeRemoteData(context: SyncRunContext, local: SyncLocalExport, remote: RemoteSnapshots): SyncSnapshot {
  const input = { local: local.snapshot, remotes: remote.snapshots };
  const ownSnapshot = remote.heads.some((head) => head.deviceId === context.identity.deviceId);
  if (!context.session.hasBaseline && !ownSnapshot && input.remotes.length > 0) return context.dependencies.algorithms.join(input);
  return context.dependencies.algorithms.merge(input);
}

async function synchronize(context: SyncRunContext): Promise<SyncRunResult> {
  const { local: store, now } = context.dependencies;
  const local = await runSyncStep(context, { phase: 'reading', action: () => store.export(context.identity) });
  const remote = await runSyncStep(context, { phase: 'reading', action: () => readRemoteSnapshots(context) });
  const snapshot = await runSyncStep(context, { phase: 'merging', action: async () => mergeRemoteData(context, local, remote) });
  const media = await runSyncStep(context, { phase: 'receiving-media', action: () =>
    prepareSyncMedia(context, { snapshot, local, remotes: remote.snapshots }) });
  // Commit the accepted generation and observed clock before publication, so concurrent edits get newer versions.
  await runSyncStep(context, { phase: 'applying', action: () => store.apply({ ...context.identity,
    snapshot, assets: media.assets, expectedGeneration: local.localGeneration, appliedAt: now() }) });
  const uploadedAssets = await runSyncStep(context, { phase: 'uploading-media', action: () => uploadSyncMedia(context, media) });
  const expectedRevision = remote.heads.find((head) => head.deviceId === context.identity.deviceId)?.revision ?? null;
  const revision = await runSyncStep(context, { phase: 'publishing', action: () =>
    publishSyncSnapshot(context, { snapshot, expectedRevision }) });
  const completion = await runSyncStep(context, { phase: 'complete', publication: 'confirmed', action: () =>
    store.finish({ ...context.identity, publishedGeneration: snapshot.generation, revision, completedAt: now() }) });
  return { ...context.identity, state: completion.pendingEdits ? 'pending' : 'synced',
    publishedGeneration: snapshot.generation, localGeneration: completion.localGeneration,
    revision, uploadedAssets, downloadedAssets: media.downloaded, repairedAssetIds: media.repairedAssetIds };
}

async function runLocked(dependencies: SyncCoordinatorDependencies): Promise<SyncRunResult> {
  const runId = validateObjectIdentity(dependencies.createRunId(), '同步运行');
  const startedAt = dependencies.now();
  const session = await dependencies.local.begin({ runId, startedAt }).catch((cause: unknown) => {
    throw new SyncCoordinatorError({ phase: 'reading', publication: 'not-started', cause });
  });
  const context: SyncRunContext = { dependencies, session,
    identity: { runId, vaultId: session.vaultId, deviceId: session.deviceId } };
  try {
    return await synchronize(context);
  } catch (cause) {
    return failSyncRun(context, cause);
  }
}

/** The caller supplies a real provider; constructing the coordinator does not contact it. */
export function createSyncCoordinator(dependencies: SyncCoordinatorDependencies): SyncCoordinator {
  return {
    syncNow: () => dependencies.lock.runExclusive(dependencies.local.scope, () => runLocked(dependencies)),
    previewSizes: (reportProgress) => previewSyncSize({ dependencies, now: dependencies.now, reporter: reportProgress }),
  };
}
