import { describe, expect, it } from 'vitest';

import { LIMITS } from '@/domain/limits';
import type { SearchEngine } from '@/domain/search-engines';
import { createDefaultSettings, validateSettings } from '@/domain/settings';

function customEngine(overrides: Partial<SearchEngine> = {}): SearchEngine {
  return {
    id: 'custom',
    name: '自定义',
    template: 'https://example.com/s?q={query}',
    builtIn: false,
    ...overrides,
  };
}

describe('validateSettings', () => {
  it('接受默认设置', () => {
    expect(validateSettings(createDefaultSettings())).toEqual(createDefaultSettings());
  });

  it('缺少自定义引擎时补为空数组', () => {
    const result = validateSettings({
      ...createDefaultSettings(),
      search: { defaultEngineId: 'google' },
    });
    expect(result.search.customEngines).toEqual([]);
  });

  it('接受合法的自定义引擎', () => {
    const result = validateSettings({
      ...createDefaultSettings(),
      search: { defaultEngineId: 'custom', customEngines: [customEngine()] },
    });
    expect(result.search.customEngines).toHaveLength(1);
  });

  it('拒绝未知的主题', () => {
    const settings = createDefaultSettings();
    expect(() =>
      validateSettings({ ...settings, appearance: { theme: 'solarized' } }),
    ).toThrowError(/主题设置不正确/);
  });

  it('拒绝未知的时钟格式', () => {
    const settings = createDefaultSettings();
    expect(() => validateSettings({ ...settings, clock: { format: 'seconds' } })).toThrowError(
      /时钟设置不正确/,
    );
  });

  it('拒绝不存在的默认引擎', () => {
    const settings = createDefaultSettings();
    expect(() =>
      validateSettings({ ...settings, search: { defaultEngineId: 'missing', customEngines: [] } }),
    ).toThrowError(/默认搜索引擎不存在/);
  });

  it('拒绝把内置引擎写入自定义列表', () => {
    const settings = createDefaultSettings();
    expect(() =>
      validateSettings({
        ...settings,
        search: {
          defaultEngineId: 'google',
          customEngines: [customEngine({ builtIn: true })],
        },
      }),
    ).toThrowError(/不能写入自定义列表/);
  });

  it('拒绝重复的自定义引擎标识', () => {
    const settings = createDefaultSettings();
    expect(() =>
      validateSettings({
        ...settings,
        search: {
          defaultEngineId: 'google',
          customEngines: [customEngine(), customEngine()],
        },
      }),
    ).toThrowError(/标识重复/);
  });

  it('拒绝超过上限的自定义引擎', () => {
    const settings = createDefaultSettings();
    const engines = Array.from({ length: LIMITS.customEngines + 1 }, (_, index) =>
      customEngine({ id: `engine-${index}` }),
    );
    expect(() =>
      validateSettings({
        ...settings,
        search: { defaultEngineId: 'google', customEngines: engines },
      }),
    ).toThrowError(/最多只能有/);
  });

  it('拒绝非法模板', () => {
    const settings = createDefaultSettings();
    expect(() =>
      validateSettings({
        ...settings,
        search: {
          defaultEngineId: 'google',
          customEngines: [customEngine({ template: 'http://example.com/s?q={query}' })],
        },
      }),
    ).toThrowError(/必须使用 https/);
  });

  it('拒绝结构损坏的设置', () => {
    expect(() => validateSettings(null)).toThrowError(/设置格式不正确/);
    expect(() => validateSettings({ ...createDefaultSettings(), layout: undefined })).toThrowError(
      /布局设置/,
    );
  });
});
