import type { SyncSnapshot } from '@/domain/sync';
import { SyncCoordinatorError } from '@/sync/errors';
import type { SyncRunContext } from '@/sync/run-context';
import { parsePublishReceipt } from '@/domain/sync/object-validation';

export async function publishSyncSnapshot(context: SyncRunContext, input: {
  readonly snapshot: SyncSnapshot;
  readonly expectedRevision: string | null;
}): Promise<string> {
  const { crypto, codec, local, objects } = context.dependencies;
  const address = { vaultId: context.identity.vaultId, objectId: context.identity.deviceId };
  const ciphertext = await crypto.encrypt({ key: context.session.key, context: { ...address, kind: 'snapshot' },
    plaintext: codec.encode(input.snapshot) });
  await local.assertCurrent(context.identity);
  await local.markPhase({ ...context.identity, phase: 'publishing', publication: 'unconfirmed' });
  try {
    const result = await objects.publishSnapshot({ ...address, expectedRevision: input.expectedRevision, ciphertext });
    return parsePublishReceipt(result).revision;
  } catch (cause) {
    throw new SyncCoordinatorError({ phase: 'publishing', publication: 'unconfirmed', cause });
  }
}
