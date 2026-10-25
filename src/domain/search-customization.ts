import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';
import { BUILT_IN_ENGINES, validateEngineTemplate } from '@/domain/search-engines';
import type { BuiltInEngineOverrides } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';

export type SearchToolGroup = 'calculation' | 'datetime' | 'color' | 'github';
export interface SearchCustomization {
  readonly corner: 'small' | 'standard' | 'pill';
  readonly surfaceOpacity: number | null;
  readonly placeholder: string;
  readonly showSites: boolean;
  readonly showFolders: boolean;
  readonly enabledTools: readonly SearchToolGroup[];
  readonly engineKeywords: Readonly<Record<string, string>>;
  readonly engineOverrides: BuiltInEngineOverrides;
}
export type SearchCustomizationPatch = Partial<Omit<SearchCustomization, 'engineKeywords' | 'engineOverrides'>>;

const DEFAULT_PLACEHOLDER = '';
const DEFAULT_TOOLS: readonly SearchToolGroup[] = ['calculation', 'datetime', 'color', 'github'];
const CORNERS = ['small', 'standard', 'pill'] as const;
const TOOL_GROUPS = ['calculation', 'datetime', 'color', 'github'] as const;
const LEGACY_CUSTOMIZATION_FIELDS = ['corner', 'surfaceOpacity', 'placeholder', 'showSites', 'showFolders', 'enabledTools', 'engineKeywords'] as const;
const CUSTOMIZATION_FIELDS = [...LEGACY_CUSTOMIZATION_FIELDS, 'engineOverrides'] as const;
const MAX_OPACITY_PERCENT = 100;
const RESERVED_KEYWORDS = new Set([
  'gh', 'ts', 'unix', 'unixms', 'date', 'datediff', 'contrast', 'color', 'time', 'timestamp', 'calculate', 'unit', '?', '=',
  '日期', '日期差', '对比度', '颜色', '时间', '时间戳',
]);

export function createDefaultSearchCustomization(): SearchCustomization {
  return { corner: 'standard', surfaceOpacity: null, placeholder: DEFAULT_PLACEHOLDER,
    showSites: true, showFolders: true, enabledTools: [...DEFAULT_TOOLS], engineKeywords: {}, engineOverrides: {} };
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}设置不正确`);
  return value;
}

function parsePlaceholder(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
    fail('搜索提示文字必须是单行纯文本');
  }
  return value;
}

function parseOpacity(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > MAX_OPACITY_PERCENT) fail('搜索背景不透明度必须为 0 到 100');
  return value as number;
}

function parseTools(value: unknown): SearchToolGroup[] {
  if (!Array.isArray(value) || value.some((item) => !TOOL_GROUPS.includes(item))) fail('快捷工具设置不正确');
  if (new Set(value).size !== value.length) fail('快捷工具设置不能重复');
  return [...value] as SearchToolGroup[];
}

function normalizeKeyword(value: unknown): string {
  if (typeof value !== 'string') fail('搜索引擎关键词必须是文本');
  const keyword = value.trim();
  if (!keyword || /[\s\u0000-\u001f\u007f-\u009f]/u.test(keyword)) fail('搜索引擎关键词必须是不含空白的单词');
  if (/[?=]/.test(keyword) || RESERVED_KEYWORDS.has(keyword.toLocaleLowerCase())) fail('搜索引擎关键词与快捷工具语法冲突');
  return keyword;
}

function parseEngineKeywords(value: unknown): Readonly<Record<string, string>> {
  const raw = asRecord(value, '搜索引擎关键词');
  const entries = Object.entries(raw).map(([id, keyword]) => [id, normalizeKeyword(keyword)] as const);
  if (new Set(entries.map(([, keyword]) => keyword.toLocaleLowerCase())).size !== entries.length) {
    fail('搜索引擎关键词不能重复');
  }
  return Object.fromEntries(entries);
}

function parseEngineOverrides(value: unknown): BuiltInEngineOverrides {
  const raw = asRecord(value, '内置搜索引擎设置');
  const overrides = Object.entries(raw).map(([id, item]) => {
    const engine = BUILT_IN_ENGINES.find((candidate) => candidate.id === id);
    if (!engine) fail(`未知的内置搜索引擎：${id}`);
    const fields = asRecord(item, '内置搜索引擎设置');
    if (Object.keys(fields).length !== 2 || !Object.hasOwn(fields, 'name') || !Object.hasOwn(fields, 'template')) {
      fail('内置搜索引擎设置字段不正确');
    }
    if (typeof fields.name !== 'string' || typeof fields.template !== 'string') fail('内置搜索引擎设置字段不正确');
    const name = normalizeEngineName(fields.name);
    const template = validateEngineTemplate(fields.template);
    if (name !== fields.name || template !== fields.template) fail('内置搜索引擎设置必须是已保存的规范格式');
    return [id, { name, template }] as const;
  });
  return Object.fromEntries(overrides);
}

export function upgradeLegacySearchCustomization(value: unknown): SearchCustomization {
  const raw = asRecord(value, '搜索自定义设置');
  if (Object.keys(raw).length !== LEGACY_CUSTOMIZATION_FIELDS.length ||
    LEGACY_CUSTOMIZATION_FIELDS.some((field) => !Object.hasOwn(raw, field))) {
    fail('旧搜索自定义设置字段不正确');
  }
  return validateSearchCustomization({ ...raw, engineOverrides: {} });
}

export function validateSearchCustomization(value: unknown): SearchCustomization {
  const raw = asRecord(value, '搜索自定义设置');
  if (Object.keys(raw).length !== CUSTOMIZATION_FIELDS.length || CUSTOMIZATION_FIELDS.some((field) => !Object.hasOwn(raw, field))) {
    fail('搜索自定义设置字段不正确');
  }
  if (!CORNERS.includes(raw.corner as (typeof CORNERS)[number])) fail('搜索框圆角设置不正确');
  return { corner: raw.corner as SearchCustomization['corner'], surfaceOpacity: parseOpacity(raw.surfaceOpacity),
    placeholder: parsePlaceholder(raw.placeholder), showSites: parseBoolean(raw.showSites, '显示网站结果'),
    showFolders: parseBoolean(raw.showFolders, '显示文件夹结果'), enabledTools: parseTools(raw.enabledTools),
    engineKeywords: parseEngineKeywords(raw.engineKeywords), engineOverrides: parseEngineOverrides(raw.engineOverrides) };
}
