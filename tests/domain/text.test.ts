import { describe, expect, it } from 'vitest';

import {
  countGraphemes,
  normalizeEngineName,
  normalizeGroupName,
  normalizeShortcutTitle,
} from '@/domain/text';

describe('countGraphemes', () => {
  it('把组合 emoji 与家庭 emoji 计为一个字符', () => {
    expect(countGraphemes('👩‍🚀')).toBe(1);
    expect(countGraphemes('👨‍👩‍👧')).toBe(1);
    expect(countGraphemes('中文')).toBe(2);
  });
});

describe('normalizeShortcutTitle', () => {
  it('去除首尾空白', () => {
    expect(normalizeShortcutTitle('  文档  ')).toBe('文档');
  });

  it('拒绝空标题', () => {
    expect(() => normalizeShortcutTitle('   ')).toThrowError(/不能为空/);
  });

  it('拒绝控制字符', () => {
    expect(() => normalizeShortcutTitle('文档\u0007')).toThrowError(/不能包含控制字符/);
  });

  it('按字素簇而不是 UTF-16 长度限制标题', () => {
    expect(() => normalizeShortcutTitle('🚀'.repeat(80))).not.toThrow();
    expect(() => normalizeShortcutTitle('🚀'.repeat(81))).toThrowError(/最多 80 个字符/);
  });
});

describe('normalizeGroupName', () => {
  it('允许重名：调用方不做唯一性校验', () => {
    expect(normalizeGroupName('常用')).toBe('常用');
    expect(normalizeGroupName('常用')).toBe('常用');
  });

  it('拒绝超过 40 个字素簇的名称', () => {
    expect(() => normalizeGroupName('字'.repeat(41))).toThrowError(/最多 40 个字符/);
  });
});

describe('normalizeEngineName', () => {
  it('拒绝空名称并限制长度', () => {
    expect(() => normalizeEngineName(' ')).toThrowError(/不能为空/);
    expect(() => normalizeEngineName('名'.repeat(41))).toThrowError(/最多 40 个字符/);
  });
});
