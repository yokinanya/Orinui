import { fail } from '@/domain/errors';

const LOCAL_ID = /^[a-z0-9_.:-]+$/i;
const LOCAL_URL = /^url\(\s*(['"]?)#([a-z0-9_.:-]+)\1\s*\)$/i;
const PAINT_TARGETS = new Set(['linearGradient', 'radialGradient', 'pattern']);
const USE_TARGETS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'symbol', 'use']);
const ATTRIBUTE_TARGETS = new Map([
  ['fill', PAINT_TARGETS], ['stroke', PAINT_TARGETS], ['clip-path', new Set(['clipPath'])], ['mask', new Set(['mask'])],
]);

export function validateSvgAttributeValue(name: string, value: string): void {
  if (/[\\\u0000-\u001f]|\/\*|\*\/|(?:var|env)\s*\(/i.test(value)) fail('SVG 不允许转义样式或动态变量');
  if (name === 'id' && !LOCAL_ID.test(value)) fail('SVG id 格式不支持');
  if (name === 'href' && !/^#[a-z0-9_.:-]+$/i.test(value)) fail('SVG 不允许外部引用');
  if (!/url\s*\(/i.test(value)) return;
  if (!['fill', 'stroke', 'clip-path', 'mask'].includes(name) || !LOCAL_URL.test(value)) {
    fail('SVG 不允许外部或不明确的资源引用');
  }
}

function referenceId(attribute: Attr): string | undefined {
  if (attribute.name === 'href') return attribute.value.slice(1);
  return LOCAL_URL.exec(attribute.value)?.[2];
}

function acceptsHref(element: Element, target: Element): boolean {
  if (element.localName === 'use') return USE_TARGETS.has(target.localName);
  return PAINT_TARGETS.has(element.localName) && target.localName === element.localName;
}

function validateTarget(element: Element, attribute: Attr, target: Element): void {
  const accepted = attribute.name === 'href' ? acceptsHref(element, target) : ATTRIBUTE_TARGETS.get(attribute.name)?.has(target.localName);
  if (!accepted) fail(`SVG「${attribute.name}」的内部引用类型不支持`);
}

function rejectCycles(edges: ReadonlyMap<Element, readonly Element[]>): void {
  const visited = new Set<Element>();
  const active = new Set<Element>();
  for (const start of edges.keys()) {
    if (visited.has(start)) continue;
    const stack = [{ element: start, exiting: false }];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item.exiting) { active.delete(item.element); visited.add(item.element); continue; }
      if (active.has(item.element)) fail('SVG 内部引用存在循环');
      if (visited.has(item.element)) continue;
      active.add(item.element);
      stack.push({ element: item.element, exiting: true });
      for (const child of edges.get(item.element)!) stack.push({ element: child, exiting: false });
    }
  }
}

export function validateSvgReferences(elements: readonly Element[]): void {
  const ids = new Map<string, Element>();
  for (const element of elements) {
    const id = element.getAttribute('id');
    if (id === null) continue;
    if (ids.has(id)) fail('SVG 含重复 id');
    ids.set(id, element);
  }
  const edges = new Map<Element, readonly Element[]>();
  for (const element of elements) {
    const targets = Array.from(element.attributes).flatMap((attribute) => {
      const id = referenceId(attribute);
      if (id === undefined) return [];
      const target = ids.get(id);
      if (!target) fail(`SVG 含不支持的内部引用「${id}」：目标不存在`);
      validateTarget(element, attribute, target);
      return [target];
    });
    edges.set(element, [...Array.from(element.children), ...targets]);
  }
  rejectCycles(edges);
}
