import { placeHome, type HomePlacement } from '@/domain/home';

/** 文件夹格位被其他条目挤开时的统一文案；拖动、键盘与菜单共用同一句。 */
export const FOLDER_POSITION_LOCKED = '文件夹位置固定，不能把其他内容放到文件夹格位上';

/**
 * 文件夹位置固定的共用守卫。
 *
 * `moveHomeItem` 会把同列碰撞链下推：只要落点与文件夹同列且重叠，文件夹就会被挤到别处。
 * 拖动、键盘移动、菜单上移/下移和小组件改高都必须先过这一关，否则同一种「移动」在不同入口
 * 会给出不同结果。返回拒绝原因；允许则为 null。
 */
export function folderPlacementConflict(
  item: HomePlacement,
  placements: readonly HomePlacement[],
): string | null {
  if (item.id.startsWith('folder:')) return null;
  const before = new Map(placements.filter((other) => other.id.startsWith('folder:')).map((other) => [other.id, other]));
  const moved = placeHome(placements, item).some((other) => {
    const original = before.get(other.id);
    return original !== undefined && (original.row !== other.row || original.column !== other.column);
  });
  return moved ? FOLDER_POSITION_LOCKED : null;
}

/** 菜单上移/下移的目标格位：相邻行，顶行上移停在原行（不产生负坐标）。 */
export type HomeMenuMove =
  | { readonly ok: true; readonly placement: HomePlacement }
  | { readonly ok: false; readonly reason: string };

/**
 * 菜单上移/下移的实际落点与守卫结果。
 *
 * 把「算目标行 → 过固定文件夹守卫」集中在一处：菜单只负责调用，避免它自己
 * 用 `Math.max(0, …)` 掩盖越界、或漏掉拖动/键盘已经在用的同一份格位视图。
 */
export function movedHomeItem(
  placement: HomePlacement,
  direction: 'up' | 'down',
  placements: readonly HomePlacement[],
): HomeMenuMove {
  const target = { ...placement, row: Math.max(0, placement.row + (direction === 'up' ? -1 : 1)) };
  const reason = folderPlacementConflict(target, placements);
  return reason === null ? { ok: true, placement: target } : { ok: false, reason };
}
