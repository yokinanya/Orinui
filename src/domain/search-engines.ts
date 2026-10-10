/**
 * 搜索引擎。
 *
 * 数据契约 §2.4：内置引擎只能选择，不能编辑或删除；默认指向 Google。
 * 模板用于拼接查询地址，`{query}` 提交前会被 URL 编码。
 * 用户自定义引擎（HTTPS、仅一个位于查询参数值中的 `{query}`）随外观与搜索设置接入。
 */

import { fail } from '@/domain/errors';

export const QUERY_PLACEHOLDER = '{query}';

export interface SearchEngine {
  id: string;
  name: string;
  template: string;
  builtIn: boolean;
}

export const DEFAULT_ENGINE_ID = 'google';

export const BUILT_IN_ENGINES: readonly SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    template: `https://www.google.com/search?q=${QUERY_PLACEHOLDER}`,
    builtIn: true,
  },
  {
    id: 'bing',
    name: 'Bing',
    template: `https://www.bing.com/search?q=${QUERY_PLACEHOLDER}`,
    builtIn: true,
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    template: `https://duckduckgo.com/?q=${QUERY_PLACEHOLDER}`,
    builtIn: true,
  },
];

export function findEngine(id: string, engines: readonly SearchEngine[] = BUILT_IN_ENGINES) {
  return engines.find((engine) => engine.id === id);
}

export function defaultEngine(engines: readonly SearchEngine[] = BUILT_IN_ENGINES) {
  const engine = findEngine(DEFAULT_ENGINE_ID, engines);
  if (!engine) {
    throw new Error('缺少默认搜索引擎配置');
  }
  return engine;
}

/** 用引擎模板拼接查询地址；查询内容先做 URL 编码。 */
export function buildSearchUrl(engine: SearchEngine, query: string): string {
  const encoded = encodeURIComponent(query);
  return engine.template.split(QUERY_PLACEHOLDER).join(encoded);
}

/**
 * 校验用户自定义的搜索模板。
 *
 * 数据契约 §2.4：必须 HTTPS、恰好一个 `{query}`，且该占位符必须是完整的查询参数值，
 * 不能出现在协议、主机或路径中，否则查询内容会改变目标地址。
 */
export function validateEngineTemplate(template: string): string {
  const trimmed = template.trim();

  const occurrences = trimmed.split(QUERY_PLACEHOLDER).length - 1;
  if (occurrences !== 1) {
    fail(`搜索地址必须包含且只包含一个 ${QUERY_PLACEHOLDER}`);
  }

  const index = trimmed.indexOf(QUERY_PLACEHOLDER);
  if (!trimmed.slice(0, index).endsWith('=')) {
    fail(`${QUERY_PLACEHOLDER} 必须作为查询参数的值`);
  }

  const rest = trimmed.slice(index + QUERY_PLACEHOLDER.length);
  if (rest !== '' && !rest.startsWith('&')) {
    fail(`${QUERY_PLACEHOLDER} 必须是完整的查询参数值`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.split(QUERY_PLACEHOLDER).join('probe'));
  } catch {
    fail('搜索地址格式不正确');
  }

  if (parsed.protocol !== 'https:') {
    fail('搜索地址必须使用 https');
  }
  if (parsed.hostname === '') {
    fail('搜索地址缺少主机名');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    fail('搜索地址不能包含用户名或密码');
  }

  return trimmed;
}

/** 按 id 在内置与自定义引擎中查找，找不到时返回 undefined。 */
export function resolveEngine(
  id: string,
  customEngines: readonly SearchEngine[] = [],
): SearchEngine | undefined {
  return [...BUILT_IN_ENGINES, ...customEngines].find((engine) => engine.id === id);
}

