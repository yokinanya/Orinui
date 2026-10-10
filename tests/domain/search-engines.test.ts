import { describe, expect, it } from 'vitest';

import {
  buildSearchUrl,
  defaultEngine,
  resolveEngine,
  validateEngineTemplate,
} from '@/domain/search-engines';

describe('validateEngineTemplate', () => {
  it('接受标准的查询参数模板', () => {
    expect(validateEngineTemplate('https://example.com/search?q={query}')).toBe(
      'https://example.com/search?q={query}',
    );
  });

  it('接受占位符后还有其他参数', () => {
    expect(validateEngineTemplate('https://example.com/s?q={query}&lang=zh')).toContain('{query}');
  });

  it('去除首尾空白', () => {
    expect(validateEngineTemplate('  https://example.com/s?q={query}  ')).toBe(
      'https://example.com/s?q={query}',
    );
  });

  it('拒绝 http 地址', () => {
    expect(() => validateEngineTemplate('http://example.com/s?q={query}')).toThrowError(
      /必须使用 https/,
    );
  });

  it('拒绝缺失或多个占位符', () => {
    expect(() => validateEngineTemplate('https://example.com/s?q=1')).toThrowError(
      /必须包含且只包含一个/,
    );
    expect(() => validateEngineTemplate('https://example.com/s?q={query}&r={query}')).toThrowError(
      /必须包含且只包含一个/,
    );
  });

  it('拒绝把占位符写在主机或路径中', () => {
    expect(() => validateEngineTemplate('https://{query}.example.com/s')).toThrowError(
      /必须作为查询参数的值/,
    );
    expect(() => validateEngineTemplate('https://example.com/{query}')).toThrowError(
      /必须作为查询参数的值/,
    );
  });

  it('拒绝把占位符当作参数名或嵌在值中间', () => {
    expect(() => validateEngineTemplate('https://example.com/s?{query}=1')).toThrowError(
      /必须作为查询参数的值/,
    );
    expect(() => validateEngineTemplate('https://example.com/s?q=a{query}')).toThrowError(
      /必须作为查询参数的值/,
    );
  });

  it('拒绝占位符后紧跟非参数内容', () => {
    expect(() => validateEngineTemplate('https://example.com/s?q={query}tail')).toThrowError(
      /必须是完整的查询参数值/,
    );
  });

  it('拒绝包含凭据的地址', () => {
    expect(() => validateEngineTemplate('https://user:pass@example.com/s?q={query}')).toThrowError(
      /不能包含用户名或密码/,
    );
  });
});

describe('buildSearchUrl', () => {
  it('编码查询内容', () => {
    const engine = defaultEngine();
    expect(buildSearchUrl(engine, 'a b&c')).toBe('https://www.google.com/search?q=a%20b%26c');
  });
});

describe('resolveEngine', () => {
  it('能找到内置引擎', () => {
    expect(resolveEngine('google')?.name).toBe('Google');
  });

  it('未知标识返回 undefined', () => {
    expect(resolveEngine('unknown')).toBeUndefined();
  });
});
