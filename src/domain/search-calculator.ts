import { fail } from '@/domain/errors';

type Token = { readonly kind: 'number'; readonly value: number } | { readonly kind: 'operator'; readonly value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let rest = source;
  while (rest.trim() !== '') {
    rest = rest.trimStart();
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) fail('数字超出可计算范围');
      tokens.push({ kind: 'number', value });
      rest = rest.slice(number[0].length);
      continue;
    }
    const operator = /^[()+*/%\-]/.exec(rest)?.[0];
    if (!operator) fail('算式包含不支持的字符');
    tokens.push({ kind: 'operator', value: operator });
    rest = rest.slice(operator.length);
  }
  return tokens;
}

class ExpressionParser {
  private index = 0;
  constructor(private readonly tokens: readonly Token[]) {}
  parse(): number {
    const value = this.addition();
    if (this.index !== this.tokens.length) fail('算式不完整');
    if (!Number.isFinite(value)) fail('计算结果超出可表示范围');
    return value;
  }
  private addition(): number {
    let value = this.multiplication();
    while (this.peek('+') || this.peek('-')) {
      const operator = this.takeOperator();
      const right = this.multiplication();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }
  private multiplication(): number {
    let value = this.unary();
    while (this.peek('*') || this.peek('/')) {
      const operator = this.takeOperator();
      const right = this.unary();
      if (operator === '/' && right === 0) fail('不能除以零');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }
  private unary(): number {
    if (this.peek('+') || this.peek('-')) return this.takeOperator() === '-' ? -this.unary() : this.unary();
    return this.postfix();
  }
  private postfix(): number {
    let value = this.primary();
    while (this.peek('%')) { this.takeOperator(); value /= 100; }
    return value;
  }
  private primary(): number {
    const token = this.tokens[this.index];
    if (token?.kind === 'number') { this.index += 1; return token.value; }
    if (this.peek('(')) {
      this.takeOperator();
      const value = this.addition();
      if (!this.peek(')')) fail('括号不匹配');
      this.takeOperator();
      return value;
    }
    return fail('算式缺少数字');
  }
  private peek(value: string): boolean {
    const token = this.tokens[this.index];
    return token?.kind === 'operator' && token.value === value;
  }
  private takeOperator(): string {
    const token = this.tokens[this.index];
    if (token?.kind !== 'operator') return fail('算式缺少运算符');
    this.index += 1;
    return token.value;
  }
}

function isPlainDate(source: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(source.trim());
}

function isImplicitExpression(source: string): boolean {
  if (!/^[\d\s.eE()+*/%\-]+$/.test(source) || isPlainDate(source)) return false;
  return /[+*/%()]/.test(source) || /\d\s*-\s*[\d.]/.test(source);
}

export type CalculationMatch =
  | { readonly matched: false }
  | { readonly matched: true; readonly value: string }
  | { readonly matched: true; readonly error: string };

export function calculateSearchExpression(query: string): CalculationMatch {
  const explicit = query.trimStart().startsWith('=');
  if (!explicit && !isImplicitExpression(query)) return { matched: false };
  try {
    const value = new ExpressionParser(tokenize(explicit ? query.trimStart().slice(1) : query)).parse();
    return { matched: true, value: String(value) };
  } catch (cause) {
    return { matched: true, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
