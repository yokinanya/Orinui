import { fail } from '@/domain/errors';

const ROOT_LAYOUT_DECLARATIONS = new Map([['flex', 'none'], ['line-height', '1']]);
const PRESENTATION_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'clip-rule', 'vector-effect', 'stop-color', 'stop-opacity',
  'clip-path', 'mask', 'display', 'visibility', 'paint-order', 'shape-rendering',
  'color-interpolation', 'color-interpolation-filters',
]);

interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly important: boolean;
  readonly layout: boolean;
}

function parseDeclaration(source: string, isRoot: boolean): Declaration {
  const match = /^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i.exec(source);
  if (!match) fail('SVG style 声明格式不正确');
  const property = match[1]!.toLowerCase();
  const important = /\s*!important\s*$/i.test(match[2]!);
  const value = match[2]!.replace(/\s*!important\s*$/i, '').trim();
  const layout = ROOT_LAYOUT_DECLARATIONS.has(property);
  if (layout && (!isRoot || ROOT_LAYOUT_DECLARATIONS.get(property) !== value.toLowerCase())) {
    fail('SVG 布局 style 仅支持根节点的 flex:none 和 line-height:1');
  }
  if (!layout && !PRESENTATION_PROPERTIES.has(property)) fail(`SVG 含不支持的 style 属性「${property}」`);
  if (/[\\\u0000-\u001f{}@!]|\/\*|\*\//.test(value) || value === '') fail('SVG style 含不支持的值或转义');
  return { property, value, important, layout };
}

/** 完整解析每项声明；不让浏览器忽略未知属性或畸形 CSS。 */
export function parseSvgStyle(source: string, isRoot: boolean): readonly Declaration[] {
  return source.split(';').filter((item) => item.trim() !== '').map((item) => parseDeclaration(item, isRoot));
}

export function normalizeSvgStyle(element: Element): void {
  const source = element.getAttribute('style');
  if (source === null) return;
  const declarations = parseSvgStyle(source, element === element.ownerDocument.documentElement);
  const selected = new Map<string, Declaration>();
  for (const declaration of declarations) {
    if (!CSS.supports(declaration.property, declaration.value)) fail(`SVG style「${declaration.property}」值不正确`);
    if (selected.get(declaration.property)?.important && !declaration.important) continue;
    selected.set(declaration.property, declaration);
  }
  const layout = Array.from(selected.values()).filter((item) => item.layout);
  for (const item of selected.values()) if (!item.layout) element.setAttribute(item.property, item.value);
  element.removeAttribute('style');
  if (layout.length > 0) element.setAttribute('style', layout.map((item) => `${item.property}:${item.value}`).join(';'));
}
