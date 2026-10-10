import { afterEach, describe, expect, it } from 'vitest';

import { canPickColorFromScreen, pickColorFromScreen } from '@/platform/eyedropper';

function stubEyeDropper(open?: () => Promise<{ sRGBHex: string }>): void {
  if (!open) {
    Reflect.deleteProperty(globalThis, 'EyeDropper');
    return;
  }

  Object.defineProperty(globalThis, 'EyeDropper', {
    configurable: true,
    writable: true,
    value: class {
      open = open;
    },
  });
}

afterEach(() => {
  stubEyeDropper();
});

describe('canPickColorFromScreen', () => {
  it('环境提供 EyeDropper 时为 true', () => {
    stubEyeDropper(async () => ({ sRGBHex: '#FFFFFF' }));
    expect(canPickColorFromScreen()).toBe(true);
  });

  it('环境缺少 EyeDropper 时为 false', () => {
    stubEyeDropper();
    expect(canPickColorFromScreen()).toBe(false);
  });
});

describe('pickColorFromScreen', () => {
  it('把取到的颜色规范为小写十六进制', async () => {
    stubEyeDropper(async () => ({ sRGBHex: '#A1B2C3' }));
    await expect(pickColorFromScreen()).resolves.toBe('#a1b2c3');
  });

  it('用户取消返回 null，不当作错误', async () => {
    stubEyeDropper(async () => {
      throw new DOMException('用户取消', 'AbortError');
    });
    await expect(pickColorFromScreen()).resolves.toBeNull();
  });

  it('其他失败向上抛出，由调用方提示', async () => {
    stubEyeDropper(async () => {
      throw new DOMException('权限被拒绝', 'NotAllowedError');
    });
    await expect(pickColorFromScreen()).rejects.toThrowError(/权限被拒绝/);
  });

  it('环境不支持时直接报错，而不是静默返回 null', async () => {
    stubEyeDropper();
    await expect(pickColorFromScreen()).rejects.toThrowError(/不支持屏幕取色/);
  });
});
