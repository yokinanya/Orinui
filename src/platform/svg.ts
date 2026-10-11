import { fail } from '@/domain/errors';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc']);
const ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'transform', 'preserveAspectRatio', 'version',
]);

function validateElement(element: Element): void {
  if (element.namespaceURI !== SVG_NS || !ELEMENTS.has(element.localName)) {
    fail('SVG 含不支持的元素，请改用 PNG/WebP');
  }
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.namespaceURI === XMLNS_NS && attribute.value === SVG_NS) continue;
    if (attribute.namespaceURI !== null || !ATTRIBUTES.has(attribute.name)) {
      fail('SVG 含不支持的属性，请改用 PNG/WebP');
    }
    if (/url\s*\(|[\\]|[\u0000-\u001f]/i.test(attribute.value)) {
      fail('SVG 不允许资源引用或转义样式，请改用 PNG/WebP');
    }
  }
}

/** 接受明确列举的静态几何子集，拒绝而不是移除未知元素和属性。 */
export function validateSvg(source: string): SVGSVGElement {
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml[^?]*\?>/i, ''))) {
    fail('SVG 不允许文档实体或处理指令');
  }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (document.querySelector('parsererror') || root.localName !== 'svg') fail('SVG 文件格式不正确');
  validateElement(root);
  for (const element of Array.from(root.querySelectorAll('*'))) validateElement(element);
  return root as unknown as SVGSVGElement;
}
