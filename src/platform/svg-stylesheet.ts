import { fail } from '@/domain/errors';
import { parseSvgStyle } from '@/platform/svg-style';
import { validateSvgAttributeValue } from '@/platform/svg-references';

type Declaration = ReturnType<typeof parseSvgStyle>[number];
interface Rule {
  readonly selector: string;
  readonly specificity: readonly number[];
  readonly declarations: readonly Declaration[];
}
interface Candidate { readonly declaration: Declaration; readonly rank: readonly number[] }

function selectorSpecificity(selector: string): readonly number[] {
  if (!/^(?:[a-z][a-z0-9-]*)?(?:[.#][a-z_][a-z0-9_-]*)*$/i.test(selector) || selector === '') {
    fail('SVG 含不支持的 CSS 选择器，仅支持元素、class、id 及其组合');
  }
  return [selector.match(/#/g)?.length ?? 0, selector.match(/\./g)?.length ?? 0, /^[a-z]/i.test(selector) ? 1 : 0];
}

function parseStylesheet(source: string): readonly Rule[] {
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let end = 0;
  for (const match of source.matchAll(pattern)) {
    if (source.slice(end, match.index).trim() !== '') fail('SVG CSS 样式表格式不正确');
    const declarations = parseSvgStyle(match[2]!, true);
    for (const declaration of declarations) {
      validateSvgAttributeValue(declaration.property, declaration.value);
      if (!CSS.supports(declaration.property, declaration.value)) fail('SVG CSS 声明值不正确');
    }
    for (const part of match[1]!.split(',')) {
      const selector = part.trim();
      rules.push({ selector, specificity: selectorSpecificity(selector), declarations });
    }
    end = match.index + match[0].length;
  }
  if (source.slice(end).trim() !== '') fail('SVG 含不支持的 CSS 样式表内容');
  return rules;
}

function wins(rank: readonly number[], previous: readonly number[] | undefined): boolean {
  if (!previous) return true;
  for (const [index, value] of rank.entries()) {
    if (value !== previous[index]) return value > previous[index]!;
  }
  return true;
}

function normalizedDeclarations(element: Element, rules: readonly Rule[]): string {
  const selected = new Map<string, Candidate>();
  const apply = (declarations: readonly Declaration[], specificity: readonly number[]) => {
    for (const declaration of declarations) {
      if (declaration.layout && element !== element.ownerDocument.documentElement) fail('SVG 布局 style 只能用于根节点');
      const rank = [Number(declaration.important), ...specificity];
      if (wins(rank, selected.get(declaration.property)?.rank)) selected.set(declaration.property, { declaration, rank });
    }
  };
  for (const rule of rules) if (element.matches(rule.selector)) apply(rule.declarations, [0, ...rule.specificity]);
  apply(parseSvgStyle(element.getAttribute('style') ?? '', element === element.ownerDocument.documentElement), [1, 0, 0, 0]);
  return Array.from(selected.values()).map(({ declaration }) => `${declaration.property}:${declaration.value}`).join(';');
}

/** 只转换静态简单选择器，完整保留优先级、声明顺序和 important；拒绝媒体查询及动态选择器。 */
export function normalizeSvgStylesheets(elements: readonly Element[]): readonly Element[] {
  const styles = elements.filter((element) => element.localName === 'style');
  const rules = styles.flatMap((style) => parseStylesheet(style.textContent ?? ''));
  const graphics = elements.filter((element) => element.localName !== 'style');
  if (rules.length > 0) for (const element of graphics) element.setAttribute('style', normalizedDeclarations(element, rules));
  for (const style of styles) style.remove();
  return graphics;
}
