/** 分组标签使用的语义色角色；null 表示按主题色板自动分配。 */
export const GROUP_COLOR_ROLES = ['primary', 'secondary', 'tertiary'] as const;

export type GroupColorRole = (typeof GROUP_COLOR_ROLES)[number];

export interface Group {
  id: string;
  name: string;
  /** 语义色角色，不保存任意 RGB（数据契约 §3） */
  colorRole: GroupColorRole | null;
  order: number;
  /** 系统默认分组：可改名，不可删除，且同一时刻只有一个 */
  isDefault: boolean;
}

export function isGroupColorRole(value: unknown): value is GroupColorRole {
  return typeof value === 'string' && (GROUP_COLOR_ROLES as readonly string[]).includes(value);
}
