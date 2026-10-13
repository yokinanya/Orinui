import { fail } from '@/domain/errors';
import { normalizeSvgStyle, parseSvgStyle } from '@/platform/svg-style';
import { validateSvgReferences, validateSvgAttributeValue } from '@/platform/svg-references';
import { normalizeSvgStylesheets } from '@/platform/svg-stylesheet';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title', 'desc',
  'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'use', 'symbol', 'style']);
const ATTRIBUTES = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'd', 'points', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'transform', 'preserveAspectRatio', 'version', 'color', 'clip-rule', 'vector-effect',
  'id', 'class', 'href', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'fx', 'fy', 'fr', 'offset', 'stop-color', 'stop-opacity',
  'clipPathUnits', 'clip-path', 'mask', 'maskUnits', 'maskContentUnits', 'patternUnits', 'patternContentUnits', 'patternTransform',
  'display', 'visibility', 'paint-order', 'shape-rendering', 'color-interpolation', 'color-interpolation-filters',
]);

function isNamespaceAttribute(attribute: Attr): boolean {
  if (attribute.namespaceURI === XMLNS_NS && [SVG_NS, XLINK_NS].includes(attribute.value)) return true;
  if (attribute.namespaceURI !== XML_NS || attribute.localName !== 'space') return false;
  if (attribute.value !== 'default' && attribute.value !== 'preserve') fail('SVG xml:space 只能是 default 或 preserve');
  return true;
}

function validatePlainAttribute(element: Element, attribute: Attr): void {
  if (attribute.name === 'type' && element.localName === 'style') {
    if (attribute.value !== 'text/css') fail('SVG 不支持此样式表类型');
    return;
  }
  if (attribute.name === 'style') {
    const declarations = parseSvgStyle(attribute.value, element === element.ownerDocument.documentElement);
    for (const declaration of declarations) validateSvgAttributeValue(declaration.property, declaration.value);
    return;
  }
  if (!ATTRIBUTES.has(attribute.name)) fail(`SVG 含不支持的属性「${attribute.name}」，请改用 PNG/WebP`);
  validateSvgAttributeValue(attribute.name, attribute.value);
}

function validateAttribute(element: Element, attribute: Attr): void {
  if (isNamespaceAttribute(attribute)) return;
  if (attribute.namespaceURI === XLINK_NS && attribute.localName === 'href') {
    validateSvgAttributeValue('href', attribute.value);
    return;
  }
  if (attribute.namespaceURI !== null) fail(`SVG 含不支持的属性「${attribute.name}」，请改用 PNG/WebP`);
  validatePlainAttribute(element, attribute);
}

function validateElement(element: Element): void {
  if (element.namespaceURI !== SVG_NS || !ELEMENTS.has(element.localName)) fail('SVG 含不支持的元素，请改用 PNG/WebP');
  if (element.localName === 'style' && element.children.length > 0) fail('SVG CSS 样式表不能包含子元素');
  for (const attribute of Array.from(element.attributes)) validateAttribute(element, attribute);
}

function normalizeXlink(element: Element): void {
  const href = element.getAttributeNS(XLINK_NS, 'href');
  if (href === null) return;
  if (element.hasAttribute('href') && element.getAttribute('href') !== href) fail('SVG href 与 xlink:href 不一致');
  element.setAttribute('href', href);
  element.removeAttributeNS(XLINK_NS, 'href');
}

/** 接受明确列举的静态几何子集，拒绝而不是移除未知元素和属性。 */
export function validateSvg(source: string): SVGSVGElement {
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(/^\s*<\?xml[^?]*\?>/i, ''))) {
    fail('SVG 不允许文档实体或处理指令');
  }
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (document.querySelector('parsererror') || root.localName !== 'svg') fail('SVG 文件格式不正确');
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const element of elements) validateElement(element);
  const graphics = normalizeSvgStylesheets(elements);
  for (const element of graphics) { normalizeSvgStyle(element); normalizeXlink(element); }
  validateSvgReferences(graphics);
  return root as unknown as SVGSVGElement;
}
