import { fail } from '@/domain/errors';

/**
 * 数据契约 §2.2：文本按 Unicode 字素簇计数，而不是 UTF-16 长度，
 * 否则 emoji 与组合字符会被错误地算作多个字符。
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** 控制字符与行分隔符不允许出现在名称中。 */
const FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

export function countGraphemes(value: string): number {
  let count = 0;
  for (const _ of segmenter.segment(value)) {
    count += 1;
  }
  return count;
}

interface TextRule {
  label: string;
  maxGraphemes: number;
}

function normalize(value: string, rule: TextRule): string {
  const trimmed = value.trim();

  if (trimmed === '') {
    fail(`${rule.label}不能为空`);
  }
  if (FORBIDDEN.test(trimmed)) {
    fail(`${rule.label}不能包含控制字符`);
  }

  const length = countGraphemes(trimmed);
  if (length > rule.maxGraphemes) {
    fail(`${rule.label}最多 ${rule.maxGraphemes} 个字符，当前 ${length} 个`);
  }

  return trimmed;
}

export function normalizeShortcutTitle(value: string): string {
  return normalize(value, { label: '网站名称', maxGraphemes: 80 });
}

export function normalizeGroupName(value: string): string {
  return normalize(value, { label: '分组名称', maxGraphemes: 40 });
}

export function normalizeEngineName(value: string): string {
  return normalize(value, { label: '搜索引擎名称', maxGraphemes: 40 });
}
