import { expect, it, vi } from 'vitest';
import { createWebDavScheduler } from '@/sync/webdav-scheduler';
import type { WebDavObservation } from '@/storage/webdav-observer';
import type { SyncStateRow } from '@/storage/sync/types';
import { deferred } from './fixtures/devices';

function observation(input: { generation: number; appliedGeneration?: number; vaultId?: string;
  deviceId?: string; nextDeleteAt?: number }): WebDavObservation {
  const state: SyncStateRow = { id: 'app', vaultId: input.vaultId ?? 'vault', deviceId: input.deviceId ?? 'device',
    clock: input.generation, generation: input.generation, defaultGroupId: { value: 'group', clock: 0, deviceId: 'device' },
    suspended: false, ...(input.appliedGeneration === undefined ? {} : { lastSync: {
      runId: 'apply', status: 'succeeded', phase: 'complete', publication: 'confirmed', startedAt: 1,
      appliedGeneration: input.appliedGeneration,
    } }) };
  return { state, nextDeleteAt: input.nextDeleteAt };
}

it('syncs on opening and local edits, but ignores coordinator-applied generations', async () => {
    const synchronize = vi.fn(async () => undefined);
    const scheduler = createWebDavScheduler({ synchronize, onError: vi.fn(), now: () => 0,
      setTimer: vi.fn(), clearTimer: vi.fn() });
    scheduler.observe(observation({ generation: 0 }));
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(1));
    scheduler.observe(observation({ generation: 1, appliedGeneration: 0 }));
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(2));
    scheduler.observe(observation({ generation: 1, appliedGeneration: 1 }));
    await Promise.resolve();
    expect(synchronize).toHaveBeenCalledTimes(2);
    scheduler.dispose();
});

it('does not poll or retry a failed unchanged generation', async () => {
    const synchronize = vi.fn(async () => { throw new Error('offline'); });
    const setTimer = vi.fn((_operation: () => void, _delay: number) => 1);
    const scheduler = createWebDavScheduler({ synchronize, onError: vi.fn(), now: () => 0,
      setTimer, clearTimer: vi.fn() });
    scheduler.observe(observation({ generation: 4 }));
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(1));
    scheduler.observe(observation({ generation: 4 }));
    await Promise.resolve();
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(setTimer).not.toHaveBeenCalled();
    scheduler.dispose();
});

it('sets one timer for a changed undo deadline and stops queued work after dispose', async () => {
    const gate = deferred<void>();
    const synchronize = vi.fn(() => gate.promise);
    const timers: Array<() => void> = [];
    const setTimer = vi.fn((operation: () => void, _delay: number) => { timers.push(operation); return timers.length; });
    const clearTimer = vi.fn();
    const scheduler = createWebDavScheduler({ synchronize, onError: vi.fn(), now: () => 10,
      setTimer, clearTimer });
    scheduler.observe(observation({ generation: 0, nextDeleteAt: 50 }));
    scheduler.observe(observation({ generation: 0, nextDeleteAt: 50 }));
    expect(setTimer).toHaveBeenCalledTimes(1);
    expect(setTimer.mock.calls[0]?.[1]).toBe(40);
    scheduler.observe(observation({ generation: 0, nextDeleteAt: 60 }));
    expect(setTimer).toHaveBeenCalledTimes(2);
    expect(clearTimer).toHaveBeenCalledTimes(1);
    timers[1]?.();
    expect(synchronize).toHaveBeenCalledTimes(1);
    scheduler.observe(observation({ generation: 1, nextDeleteAt: 50 }));
    scheduler.dispose();
    gate.resolve();
    await vi.waitFor(() => expect(synchronize).toHaveBeenCalledTimes(1));
    expect(clearTimer).toHaveBeenCalled();
});
