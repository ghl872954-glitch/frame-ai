/**
 * 安全计算器。
 *
 * 刻意不用 eval / new Function —— 那是把一个任意代码执行漏洞塞进产品里。
 * 这里手写词法分析和递归下降解析，只认数字、运算符和一张白名单函数表。
 * 遇到任何不认识的字符直接报错，不会执行任何东西。
 */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log,
  log10: Math.log10,
  exp: Math.exp,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

type Token =
  | { type: 'number'; value: number }
  | { type: 'ident'; value: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' };

export class CalcError extends Error {}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < input.length && /[0-9._]/.test(input[i])) {
        // 允许 1_000 这种写法，但只作为分隔符
        if (input[i] !== '_') num += input[i];
        i += 1;
      }
      // 科学计数法
      if (i < input.length && /[eE]/.test(input[i]) && /[0-9+-]/.test(input[i + 1] ?? '')) {
        num += input[i];
        i += 1;
        if (/[+-]/.test(input[i])) {
          num += input[i];
          i += 1;
        }
        while (i < input.length && /[0-9]/.test(input[i])) {
          num += input[i];
          i += 1;
        }
      }
      const value = Number(num);
      if (!Number.isFinite(value)) throw new CalcError(`看不懂这个数字：${num}`);
      tokens.push({ type: 'number', value });
      continue;
    }

    if (/[a-zA-Z]/.test(ch)) {
      let name = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        name += input[i];
        i += 1;
      }
      tokens.push({ type: 'ident', value: name });
      continue;
    }

    if ('+-*/%^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    if (ch === '(' || ch === '（') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')' || ch === '）') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === ',' || ch === '，') {
      tokens.push({ type: 'comma' });
      i += 1;
      continue;
    }
    if (ch === '×') {
      tokens.push({ type: 'op', value: '*' });
      i += 1;
      continue;
    }
    if (ch === '÷') {
      tokens.push({ type: 'op', value: '/' });
      i += 1;
      continue;
    }

    throw new CalcError(`算式里有不认识的字符：${ch}`);
  }

  return tokens;
}

class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new CalcError('算式没写完，或者多了些东西');
    }
    return value;
  }

  /** 加减 */
  private parseExpression(): number {
    let left = this.parseTerm();
    for (;;) {
      const token = this.tokens[this.pos];
      if (token?.type === 'op' && (token.value === '+' || token.value === '-')) {
        this.pos += 1;
        const right = this.parseTerm();
        left = token.value === '+' ? left + right : left - right;
      } else {
        return left;
      }
    }
  }

  /** 乘除取模 */
  private parseTerm(): number {
    let left = this.parsePower();
    for (;;) {
      const token = this.tokens[this.pos];
      if (token?.type === 'op' && ['*', '/', '%'].includes(token.value)) {
        this.pos += 1;
        const right = this.parsePower();
        if (token.value === '*') left *= right;
        else if (token.value === '/') {
          if (right === 0) throw new CalcError('除以零');
          left /= right;
        } else {
          if (right === 0) throw new CalcError('对零取模');
          left %= right;
        }
      } else {
        return left;
      }
    }
  }

  /** 幂，右结合 */
  private parsePower(): number {
    const base = this.parseUnary();
    const token = this.tokens[this.pos];
    if (token?.type === 'op' && token.value === '^') {
      this.pos += 1;
      const exponent = this.parsePower();
      return Math.pow(base, exponent);
    }
    return base;
  }

  private parseUnary(): number {
    const token = this.tokens[this.pos];
    if (token?.type === 'op' && (token.value === '-' || token.value === '+')) {
      this.pos += 1;
      const value = this.parseUnary();
      return token.value === '-' ? -value : value;
    }
    return this.parseAtom();
  }

  private parseAtom(): number {
    const token = this.tokens[this.pos];
    if (!token) throw new CalcError('算式不完整');

    if (token.type === 'number') {
      this.pos += 1;
      return token.value;
    }

    if (token.type === 'lparen') {
      this.pos += 1;
      const value = this.parseExpression();
      if (this.tokens[this.pos]?.type !== 'rparen') throw new CalcError('括号没配对');
      this.pos += 1;
      return value;
    }

    if (token.type === 'ident') {
      this.pos += 1;
      const name = token.value.toLowerCase();

      if (name in CONSTANTS) return CONSTANTS[name];

      const fn = FUNCTIONS[name];
      if (!fn) throw new CalcError(`不认识的函数或常量：${token.value}`);

      if (this.tokens[this.pos]?.type !== 'lparen') {
        throw new CalcError(`${token.value} 后面要跟括号`);
      }
      this.pos += 1;

      const args: number[] = [];
      if (this.tokens[this.pos]?.type !== 'rparen') {
        args.push(this.parseExpression());
        while (this.tokens[this.pos]?.type === 'comma') {
          this.pos += 1;
          args.push(this.parseExpression());
        }
      }
      if (this.tokens[this.pos]?.type !== 'rparen') throw new CalcError('函数括号没配对');
      this.pos += 1;

      if (args.length === 0) throw new CalcError(`${token.value} 需要参数`);
      return fn(...args);
    }

    throw new CalcError('算式里有不认识的东西');
  }
}

export interface CalcResult {
  value: number;
  formatted: string;
}

export function calculate(expression: string): CalcResult {
  const trimmed = (expression ?? '').trim();
  if (!trimmed) throw new CalcError('算式是空的');
  if (trimmed.length > 500) throw new CalcError('算式太长了');

  const value = new Parser(tokenize(trimmed)).parse();
  if (!Number.isFinite(value)) throw new CalcError('算出来不是一个有限数');

  return { value, formatted: formatNumber(value) };
}

function formatNumber(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  return String(rounded);
}
