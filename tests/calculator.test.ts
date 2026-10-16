import { describe, expect, it } from 'vitest';

import { CalcError, calculate } from '@/lib/tools/calculator';

function value(expression: string): number {
  return calculate(expression).value;
}

describe('calculate 安全计算器', () => {
  it('四则运算与优先级', () => {
    expect(value('1+2*3')).toBe(7);
    expect(value('(1+2)*3')).toBe(9);
    expect(value('10-4-3')).toBe(3);
    expect(value('7/2')).toBe(3.5);
    expect(value('10%3')).toBe(1);
  });

  it('幂是右结合的', () => {
    expect(value('2^3^2')).toBe(512);
    expect(value('(2^3)^2')).toBe(64);
  });

  it('一元正负号', () => {
    expect(value('-5+3')).toBe(-2);
    expect(value('--5')).toBe(5);
    expect(value('-(2+3)')).toBe(-5);
  });

  it('白名单函数能用', () => {
    expect(value('sqrt(16)')).toBe(4);
    expect(value('abs(-5)')).toBe(5);
    expect(value('round(2.5)')).toBe(3);
    expect(value('floor(2.9)')).toBe(2);
    expect(value('max(1,2,3)')).toBe(3);
    expect(value('min(1,2,3)')).toBe(1);
    expect(value('pow(2,10)')).toBe(1024);
    expect(value('log10(1000)')).toBe(3);
  });

  it('常量能用', () => {
    expect(value('pi')).toBeCloseTo(Math.PI, 10);
    expect(value('e')).toBeCloseTo(Math.E, 10);
  });

  it('函数名大小写不敏感', () => {
    expect(value('SQRT(9)')).toBe(3);
    expect(value('Max(1,5)')).toBe(5);
  });

  it('中文全角符号和乘除号也认', () => {
    expect(value('2×3')).toBe(6);
    expect(value('8÷2')).toBe(4);
    expect(value('（1+2）*3')).toBe(9);
  });

  it('下划线当千分位分隔符', () => {
    expect(value('1_000+1')).toBe(1001);
  });

  it('科学计数法', () => {
    expect(value('1e3')).toBe(1000);
    expect(value('1.5e2')).toBe(150);
    expect(value('2e-2')).toBe(0.02);
  });

  it('浮点误差在展示层抹掉，不把 0.30000000000000004 甩给用户', () => {
    expect(calculate('0.1+0.2').formatted).toBe('0.3');
  });

  it('整数结果不带小数点', () => {
    expect(calculate('2+2').formatted).toBe('4');
    expect(calculate('6/3').formatted).toBe('2');
  });
});

describe('calculate 拒绝一切非算式输入', () => {
  it('空算式报错，不返回 NaN', () => {
    expect(() => calculate('')).toThrow(CalcError);
    expect(() => calculate('   ')).toThrow(CalcError);
  });

  it('不认识的函数直接报错，绝不执行', () => {
    expect(() => calculate('alert(1)')).toThrow(/不认识的函数/);
    expect(() => calculate('eval(1)')).toThrow(/不认识的函数/);
    expect(() => calculate('require(1)')).toThrow(/不认识的函数/);
  });

  it('不认识的字符直接报错', () => {
    expect(() => calculate('1 & 2')).toThrow(/不认识的字符/);
    expect(() => calculate('a[0]')).toThrow(CalcError);
    expect(() => calculate('1;2')).toThrow(CalcError);
  });

  it('shell 命令进不来', () => {
    expect(() => calculate('rm -rf /')).toThrow(CalcError);
    expect(() => calculate('$(whoami)')).toThrow(CalcError);
  });

  it('除以零和模零都报错，不给 Infinity', () => {
    expect(() => calculate('1/0')).toThrow(/除以零/);
    expect(() => calculate('5%0')).toThrow(/对零取模/);
  });

  it('括号不配对报错', () => {
    expect(() => calculate('(1+2')).toThrow(/括号/);
    expect(() => calculate('1+2)')).toThrow(CalcError);
  });

  it('算式没写完报错', () => {
    expect(() => calculate('1+')).toThrow(CalcError);
    expect(() => calculate('1 2')).toThrow(/没写完/);
  });

  it('函数后面必须跟括号', () => {
    expect(() => calculate('sqrt 16')).toThrow(/要跟括号/);
  });

  it('超长算式直接拒，防止有人拿来打解析器', () => {
    expect(() => calculate('1+'.repeat(400) + '1')).toThrow(/太长/);
  });

  it('结果不是有限数时报错', () => {
    expect(() => calculate('1e308*10')).toThrow(/有限数/);
  });
});
