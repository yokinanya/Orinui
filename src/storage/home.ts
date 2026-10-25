import type { Database } from '@/storage/db';
import { readSettings } from '@/storage/settings';
import { EMPTY_HOME, firstHomeSpace, homeKey, placeHome, reconcileHome, validateHome, assertHomeDisjoint,
  type HomeData, type HomePlacement, type HomeWidget } from '@/domain/home';
import { fail } from '@/domain/errors';

export async function reconcileStoredHome(db: Database): Promise<void> {
  const settings = await readSettings(db);
  const home = reconcileHome({ home: settings.home ?? EMPTY_HOME,
    folders: await db.folders.toArray(), shortcuts: await db.shortcuts.toArray() });
  if (JSON.stringify(home) !== JSON.stringify(settings.home)) await db.settings.put({ ...settings, home, id: 'app' });
}
export async function changeHome(db: Database, change: (home: HomeData) => HomeData): Promise<void> {
  await db.transaction('rw', [db.settings, db.folders, db.shortcuts], async () => {
    await reconcileStoredHome(db);
    const settings = await readSettings(db);
    const home = validateHome(change(settings.home ?? EMPTY_HOME));
    assertHomeDisjoint(home.placements);
    await db.settings.put({ ...settings, home, id: 'app' });
  });
}
export async function moveHomeItem(db: Database, placement: HomePlacement): Promise<void> {
  await changeHome(db, (home) => {
    if (!home.placements.some(({ id }) => id === placement.id)) fail('主页条目不存在');
    return { ...home, placements: placeHome(home.placements, placement) };
  });
}
export async function changeWidgetHeight(db: Database, id: string, height: number): Promise<void> {
  await changeHome(db, (home) => {
    const placement = home.placements.find(({ id: itemId }) => itemId === homeKey('widget', id));
    if (!placement) fail('主页小组件不存在');
    return { ...home, placements: placeHome(home.placements, { ...placement, height }) };
  });
}
export async function saveWidget(db: Database, widget: HomeWidget): Promise<void> {
  await changeHome(db, (home) => {
    const existing = home.widgets.some(({ id }) => id === widget.id);
    const widgets = existing ? home.widgets.map((item) => item.id === widget.id ? widget : item) : [...home.widgets, widget];
    const placements = existing ? home.placements : [...home.placements,
      firstHomeSpace(home.placements, { id: homeKey('widget', widget.id), height: 3 })];
    return { placements, widgets };
  });
}
export async function deleteWidget(db: Database, id: string): Promise<void> {
  await changeHome(db, (home) => ({ widgets: home.widgets.filter((item) => item.id !== id),
    placements: home.placements.filter((item) => item.id !== homeKey('widget', id)) }));
}
export async function resetHomePositions(db: Database): Promise<void> {
  await changeHome(db, (home) => {
    const sorted = home.placements.toSorted((a, b) => a.row - b.row || a.column - b.column);
    const placements = sorted.reduce<HomePlacement[]>((placed, item) => [...placed,
      firstHomeSpace(placed, { id: item.id, height: item.height })], []);
    return { ...home, placements };
  });
}
