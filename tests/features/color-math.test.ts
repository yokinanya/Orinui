import { describe, expect, it } from 'vitest';

import {
  hexToHsv,
  hsvToHex,
  hsvToRgb,
  hueCss,
  parseHex,
  rgbToHsv,
  toHex,
} from '@/features/appearance/color-math';

describe('parseHex', () => {
  it('解析 #rrggbb 以及省略井号的写法', () => {
    expect(parseHex('#3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
    expect(parseHex('3b82f6')).toEqual({ r: 59, g: 130, b: 246 });
  });

  it('大小写与前后空白不影响结果', () => {
    expect(parseHex('  #3B82F6  ')).toEqual({ r: 59, g: 130, b: 246 });
  });

  it('长度不足、含非法字符或三位简写都返回 null', () => {
    expect(parseHex('#abc')).toBeNull();
    expect(parseHex('#12345g')).toBeNull();
    expect(parseHex('rgb(1,2,3)')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('toHex', () => {
  it('每个通道补齐两位', () => {
    expect(toHex({ r: 0, g: 8, b: 255 })).toBe('#0008ff');
  });

  it('把通道收敛到 0–255 并取整', () => {
    expect(toHex({ r: -20, g: 300, b: 127.6 })).toBe('#00ff80');
  });
});

describe('rgbToHsv', () => {
  it('纯红为 0 度、饱和与明度满值', () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, v: 100 });
  });

  it('灰阶饱和度为 0', () => {
    const grey = rgbToHsv({ r: 128, g: 128, b: 128 });
    expect(grey.s).toBe(0);
    expect(grey.v).toBeCloseTo((128 / 255) * 100, 6);
  });

  it('黑色明度为 0', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 }).v).toBe(0);
  });

  it('保留浮点精度而不是取整', () => {
    // 取整会让 #000001 与 #000002 得到同一个 HSV，从而在拖动时产生通道漂移
    expect(rgbToHsv({ r: 0, g: 0, b: 1 })).not.toEqual(rgbToHsv({ r: 0, g: 0, b: 2 }));
  });
});

describe('十六进制往返', () => {
  it('对采样空间逐色往返一致', () => {
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = toHex({ r, g, b });
          expect(hsvToHex(hexToHsv(hex)), `${hex} 往返`).toBe(hex);
        }
      }
    }
  });

  it('对全部灰阶往返一致', () => {
    for (let channel = 0; channel < 256; channel += 1) {
      const hex = toHex({ r: channel, g: channel, b: channel });
      expect(hsvToHex(hexToHsv(hex)), `${hex} 往返`).toBe(hex);
    }
  });

  it('极端值往返一致', () => {
    for (const hex of ['#000000', '#ffffff', '#000001', '#fffffe', '#f4efe6', '#0a0b0c']) {
      expect(hsvToHex(hexToHsv(hex)), `${hex} 往返`).toBe(hex);
    }
  });
});

describe('hsvToRgb', () => {
  it('色相超出 0–360 时按圈取模', () => {
    expect(hsvToRgb({ h: 360, s: 100, v: 100 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 120, s: 100, v: 100 })).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('非法颜色解析回退到中性灰', () => {
    expect(hexToHsv('nope')).toEqual({ h: 0, s: 0, v: 50 });
  });
});

describe('hueCss', () => {
  it('输出对应色相的 CSS 颜色', () => {
    expect(hueCss(120)).toBe('hsl(120 100% 50%)');
  });

  it('负数色相按圈归一', () => {
    expect(hueCss(-60)).toBe('hsl(300 100% 50%)');
  });
});
