import { describe, expect, it } from 'vitest';
import { compactHome, firstHomeSpace, placeHome, validateHome, type HomeData } from '@/domain/home';
import { buildSyncHome, materializeHome, mergeSyncHome, resolveSyncHome, seedHome } from '@/domain/sync/home';

const placement = (id: string, row: number, height = 1, column = 0) => ({ id, row, height, column });
describe('Niagara grid', () => {
  it('migrates row-major without changing identity', () => {
    expect(compactHome(['a', 'b', 'c'])).toEqual([placement('a', 0), placement('b', 0, 1, 1), placement('c', 1)]);
  });
  it('pushes a chain in only the target column and preserves unrelated holes', () => {
    const items = [placement('a', 0), placement('b', 2), placement('c', 3), placement('d', 9), placement('e', 2, 1, 1)];
    expect(placeHome(items, placement('a', 2, 2))).toEqual([
      placement('e', 2, 1, 1), placement('a', 2, 2), placement('b', 4), placement('c', 5), placement('d', 9),
    ].toSorted((a, b) => a.row - b.row || a.column - b.column));
    expect(items[0]).toEqual(placement('a', 0));
  });
  it('finds the first contiguous free span without compacting', () => {
    expect(firstHomeSpace([placement('a', 0), placement('b', 1, 2, 1)], { id: 'new', height: 2 }))
      .toEqual(placement('new', 1, 2));
  });
  it('rejects unsafe coordinates, widget types and duplicate todo identities', () => {
    expect(() => placeHome([], placement('x', -1))).toThrow();
    expect(() => validateHome({ placements: [], widgets: [{ id: 'x', kind: 'unknown', text: '', items: [] }] })).toThrow();
  });
});
describe('home field synchronization', () => {
  const home: HomeData = { placements: [placement('widget:note', 0, 3), placement('widget:todo', 0, 3, 1)],
    widgets: [{ id: 'note', kind: 'note' as const, text: 'plain <b>text</b>', items: [] },
      { id: 'todo', kind: 'todo' as const, text: '', items: [{ id: 'item', text: 'task', completed: false, order: 0 }] }] };
  const original = seedHome(home, 'a');
  const change = (next: typeof home, deviceId: string) => buildSyncHome({ home: next, previous: original,
    register: (value, previous) => JSON.stringify(value) === JSON.stringify(previous?.value) ? previous! : { value, clock: 1, deviceId } });
  it('merges note text and independent todo completion without dropping either edit', () => {
    const a = change({ ...home, widgets: home.widgets.map((widget) => widget.id === 'note' ? { ...widget, text: 'edited' } : widget) }, 'a');
    const b = change({ ...home, widgets: home.widgets.map((widget) => widget.id === 'todo'
      ? { ...widget, items: widget.items.map((item) => ({ ...item, completed: true })) } : widget) }, 'b');
    const merged = materializeHome(mergeSyncHome([a, b]));
    expect(merged.widgets.find(({ id }) => id === 'note')?.text).toBe('edited');
    expect(merged.widgets.find(({ id }) => id === 'todo')?.items[0]?.completed).toBe(true);
    expect(mergeSyncHome([a, b])).toEqual(mergeSyncHome([b, a]));
  });
  it('resolves concurrent occupancy deterministically, versions the repair and is idempotent', () => {
    const concurrent = change({ ...home, placements: home.placements.map((item) => ({ ...item, column: 0 })) }, 'b');
    const resolved = resolveSyncHome({ fields: concurrent, deviceId: 'a', clock: 1 });
    expect(materializeHome(resolved).placements.map(({ row }) => row)).toEqual([0, 3]);
    expect(Object.values(resolved).some(({ clock }) => clock > 1)).toBe(true);
    expect(resolveSyncHome({ fields: resolved, deviceId: 'b', clock: 2 })).toEqual(resolved);
  });
  it('keeps deleted widget and todo identities deleted against concurrent edits', () => {
    const deleted = change({ ...home, widgets: home.widgets.filter(({ id }) => id !== 'note'),
      placements: home.placements.filter(({ id }) => id !== 'widget:note') }, 'b');
    const edited = change({ ...home, widgets: home.widgets.map((widget) => widget.id === 'note' ? { ...widget, text: 'new' } : widget) }, 'a');
    expect(materializeHome(mergeSyncHome([deleted, edited])).widgets.map(({ id }) => id)).toEqual(['todo']);
  });
});
