import { describe, expect, it } from 'vitest';

import { LIMITS } from '@/domain/limits';
import { normalizeShortcutUrl } from '@/domain/url';

describe('normalizeShortcutUrl', () => {
  it('缺少协议时补 https 并保留路径', () => {
    expect(normalizeShortcutUrl('example.com/docs/a')).toBe('https://example.com/docs/a');
  });

  it('去除首尾空白', () => {
    expect(normalizeShortcutUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it('保留查询参数与片段', () => {
    expect(normalizeShortcutUrl('example.com/s?q=1&b=2#top')).toBe(
      'https://example.com/s?q=1&b=2#top',
    );
  });

  it('接受 http 与本地地址', () => {
    expect(normalizeShortcutUrl('http://localhost:3000/app')).toBe('http://localhost:3000/app');
    expect(normalizeShortcutUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['file:///etc/passwd'],
    ['ftp://example.com'],
  ])('拒绝非 http(s) 协议：%s', (input) => {
    expect(() => normalizeShortcutUrl(input)).toThrowError(/只支持 http 或 https 网址/);
  });

  it('拒绝包含用户名或密码的地址', () => {
    expect(() => normalizeShortcutUrl('https://user:pass@example.com')).toThrowError(
      /不能包含用户名或密码/,
    );
  });

  it('拒绝空地址', () => {
    expect(() => normalizeShortcutUrl('   ')).toThrowError(/不能为空/);
  });

  it('拒绝超过长度上限的地址', () => {
    const long = `https://example.com/${'a'.repeat(LIMITS.urlChars)}`;
    expect(() => normalizeShortcutUrl(long)).toThrowError(/最多/);
  });
});
