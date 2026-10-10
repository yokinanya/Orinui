import {
  createDefaultAppearance,
  validateAppearance,
  type AppearanceSettings,
} from '@/domain/appearance';
import { fail } from '@/domain/errors';
import { DEFAULT_LAYOUT, validateLayout, type LayoutConfig } from '@/domain/layout';
import { LIMITS } from '@/domain/limits';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import { asRecord } from '@/domain/validate';

/** 时钟格式三态：跟随系统或手动固定。 */
export type ClockFormat = 'system' | '12h' | '24h';

export interface AppSettings {
  appearance: AppearanceSettings;
  search: {
    defaultEngineId: string;
    /** 用户自定义引擎，上限见 LIMITS.customEngines */
    customEngines: SearchEngine[];
  };
  layout: LayoutConfig;
  clock: {
    format: ClockFormat;
  };
}

/** 数据契约 §10 的默认值。 */
export function createDefaultSettings(): AppSettings {
  return {
    appearance: createDefaultAppearance(),
    search: { defaultEngineId: 'google', customEngines: [] },
    layout: { order: [...DEFAULT_LAYOUT.order], hidden: [...DEFAULT_LAYOUT.hidden] },
    clock: { format: 'system' },
  };
}

export function isClockFormat(value: unknown): value is ClockFormat {
  return value === 'system' || value === '12h' || value === '24h';
}

function validateCustomEngines(value: unknown): SearchEngine[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    fail('自定义搜索引擎格式不正确');
  }
  if (value.length > LIMITS.customEngines) {
    fail(`最多只能有 ${LIMITS.customEngines} 个自定义搜索引擎`);
  }

  const engines: SearchEngine[] = [];
  const ids = new Set<string>();

  for (const item of value) {
    const raw = asRecord(item, '自定义搜索引擎');
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      fail('自定义搜索引擎缺少标识');
    }
    if (ids.has(raw.id)) {
      fail('自定义搜索引擎标识重复');
    }
    if (typeof raw.template !== 'string') {
      fail('自定义搜索引擎缺少搜索地址');
    }
    if (raw.builtIn === true) {
      fail('内置搜索引擎不能写入自定义列表');
    }
    if (typeof raw.name !== 'string') {
      fail('自定义搜索引擎缺少名称');
    }

    ids.add(raw.id);
    engines.push({
      id: raw.id,
      name: normalizeEngineName(raw.name),
      template: validateEngineTemplate(raw.template),
      builtIn: false,
    });
  }

  return engines;
}

/**
 * 校验设置对象并返回规范化副本。
 *
 * 只读取已知字段，忽略额外键（设置行自身带有 id 等存储字段）；
 * 备份文件的未知字段检查由备份校验单独负责。
 */
export function validateSettings(value: unknown): AppSettings {
  const raw = asRecord(value, '设置');

  const search = asRecord(raw.search, '搜索设置');
  if (typeof search.defaultEngineId !== 'string' || search.defaultEngineId.trim() === '') {
    fail('默认搜索引擎不正确');
  }
  const customEngines = validateCustomEngines(search.customEngines);
  if (!resolveEngine(search.defaultEngineId, customEngines)) {
    fail('默认搜索引擎不存在');
  }

  const clock = asRecord(raw.clock, '时钟设置');
  if (!isClockFormat(clock.format)) {
    fail('时钟设置不正确');
  }

  return {
    appearance: validateAppearance(raw.appearance),
    search: { defaultEngineId: search.defaultEngineId, customEngines },
    layout: validateLayout(raw.layout),
    clock: { format: clock.format },
  };
}
