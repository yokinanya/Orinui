import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';

/**
 * 浏览器书签偏好。
 *
 * 浏览器书签本体（标题、地址、顺序、图标、缓存）永不进入 Orinui 数据：不写入
 * folders/shortcuts/settings.home/assets，不计入备份或同步快照。这里只保存用户
 * 自己的展示偏好与隐藏规则，而且是唯一允许携带浏览器侧标识（节点 ID 与标题路径）
 * 的数据片段。
 *
 * 隐藏粒度只有浏览器根与普通文件夹（递归覆盖后代），没有单条链接隐藏。
 * 规则按 `ruleId` 逐条同步；`pending` 匹配结果是每台设备按当前树重新推导的，
 * 不落库、不同步。
 */
export const BOOKMARK_MODES = ['region', 'folder'] as const;
export type BookmarkMode = (typeof BOOKMARK_MODES)[number];

export const BOOKMARK_RULE_KINDS = ['root', 'folder'] as const;
export type BookmarkRuleKind = (typeof BOOKMARK_RULE_KINDS)[number];

export interface BookmarkHiddenRule {
  /** Orinui 生成，稳定且不复用；逐条同步寄存器的键。 */
  readonly ruleId: string;
  /** 创建规则时的浏览器节点 ID；ID 优先、路径回退，不作为唯一依据。 */
  readonly targetId: string;
  /**
   * 从浏览器根标题到目标标题的规范化路径分段。
   *
   * 用数组而不是拼接字符串，避免标题中的 `/` 造成歧义。
   */
  readonly path: readonly string[];
  readonly kind: BookmarkRuleKind;
  /** 当前是否隐藏；false 是用户显式取消隐藏，不是删除。 */
  readonly hidden: boolean;
  /** 本地编辑时间，用于展示与排序，不参与同步决胜。 */
  readonly updatedAt: number;
}

export interface BookmarkPreferences {
  enabled: boolean;
  mode: BookmarkMode;
  showInSearch: boolean;
  hiddenRules: readonly BookmarkHiddenRule[];
}

export const DEFAULT_BOOKMARK_PREFERENCES: BookmarkPreferences = {
  enabled: false,
  mode: 'region',
  showInSearch: true,
  hiddenRules: [],
};

export function createDefaultBookmarkPreferences(): BookmarkPreferences {
  return { ...DEFAULT_BOOKMARK_PREFERENCES, hiddenRules: [] };
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label}不正确`);
  return value;
}

/**
 * 路径分段忠实保留浏览器标题原文。
 *
 * 浏览器允许空标题、首尾空白、非 ASCII 与含 `/` 的标题；这些都已经在数组分段里表达，
 * 不会产生分隔歧义，因此这里不 trim、不规范化、不截断，只在匹配时规范化。
 */
function rulePath(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) fail('隐藏规则路径不正确');
  return value.map((segment) => {
    if (typeof segment !== 'string') fail('隐藏规则路径分段不正确');
    return segment;
  });
}

export function validateBookmarkHiddenRule(value: unknown): BookmarkHiddenRule {
  const raw = asRecord(value, '隐藏规则');
  if (Object.keys(raw).some((key) => !['ruleId', 'targetId', 'path', 'kind', 'hidden', 'updatedAt'].includes(key))) {
    fail('隐藏规则包含未知字段');
  }
  if (raw.kind !== 'root' && raw.kind !== 'folder') fail('隐藏规则只支持浏览器根或普通文件夹');
  if (typeof raw.hidden !== 'boolean') fail('隐藏规则状态不正确');
  if (!Number.isSafeInteger(raw.updatedAt) || Number(raw.updatedAt) < 0) fail('隐藏规则时间不正确');
  return { ruleId: text(raw.ruleId, '隐藏规则标识'), targetId: text(raw.targetId, '隐藏规则目标'),
    path: rulePath(raw.path), kind: raw.kind, hidden: raw.hidden, updatedAt: Number(raw.updatedAt) };
}

function validateBookmarkRules(value: unknown): BookmarkHiddenRule[] {
  if (!Array.isArray(value)) fail('隐藏规则列表格式不正确');
  const rules = value.map(validateBookmarkHiddenRule);
  if (new Set(rules.map(({ ruleId }) => ruleId)).size !== rules.length) fail('隐藏规则标识不能重复');
  return rules.toSorted((left, right) => left.ruleId < right.ruleId ? -1 : Number(left.ruleId !== right.ruleId));
}

/** 严格校验书签偏好；未知字段、未知模式与非法规则都明确报错。 */
export function validateBookmarkPreferences(value: unknown): BookmarkPreferences {
  const raw = asRecord(value, '浏览器书签设置');
  if (Object.keys(raw).some((key) => !['enabled', 'mode', 'showInSearch', 'hiddenRules'].includes(key))) {
    fail('浏览器书签设置包含未知字段');
  }
  if (typeof raw.enabled !== 'boolean') fail('浏览器书签启用状态不正确');
  if (!BOOKMARK_MODES.includes(raw.mode as BookmarkMode)) fail('浏览器书签显示模式不正确');
  if (typeof raw.showInSearch !== 'boolean') fail('浏览器书签搜索开关不正确');
  return { enabled: raw.enabled, mode: raw.mode as BookmarkMode, showInSearch: raw.showInSearch,
    hiddenRules: validateBookmarkRules(raw.hiddenRules ?? []) };
}

/**
 * 应用偏好补丁；`hiddenRules` 不通过该入口修改，规则只能逐条增删，
 * 避免整表覆盖其他设备的并发编辑。
 */
export function applyBookmarkPreferencePatch(
  current: BookmarkPreferences,
  patch: Partial<Pick<BookmarkPreferences, 'enabled' | 'mode' | 'showInSearch'>>,
): BookmarkPreferences {
  return validateBookmarkPreferences({ ...current, ...patch });
}

/** 关闭功能视为放弃显示意图；本地缓存与规则由调用方按缓存边界处理。 */
export function disableBookmarks(current: BookmarkPreferences): BookmarkPreferences {
  return { ...current, enabled: false };
}
