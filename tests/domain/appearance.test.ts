import { describe, expect, it } from 'vitest';

import {
  backgroundSeed,
  createDefaultAppearance,
  resolveSeed,
  validateAppearance,
  type AppearanceSettings,
} from '@/domain/appearance';

function appearance(overrides: Partial<AppearanceSettings> = {}): AppearanceSettings {
  return { ...createDefaultAppearance(), ...overrides };
}

describe('validateAppearance', () => {
  it('接受默认外观', () => {
    expect(validateAppearance(createDefaultAppearance())).toEqual(createDefaultAppearance());
  });

  it('拒绝未知主题', () => {
    expect(() => validateAppearance(appearance({ theme: 'sepia' as never }))).toThrowError(
      /主题设置不正确/,
    );
  });

  it('拒绝未知背景类型', () => {
    expect(() =>
      validateAppearance(appearance({ background: { kind: 'video' } as never })),
    ).toThrowError(/背景类型不正确/);
  });

  it('规范颜色为小写并校验格式', () => {
    const result = validateAppearance(appearance({ background: { kind: 'solid', color: '#AABBCC' } }));
    expect(result.background).toEqual({ kind: 'solid', color: '#aabbcc' });

    expect(() =>
      validateAppearance(appearance({ background: { kind: 'solid', color: 'red' } as never })),
    ).toThrowError(/需要 #RRGGBB/);
  });

  it('拒绝越界的遮罩强度', () => {
    expect(() =>
      validateAppearance(
        appearance({ background: { kind: 'photo', assetId: 'a1', maskStrength: 1.5 } }),
      ),
    ).toThrowError(/遮罩强度/);
  });

  it('照片背景缺少标识时拒绝', () => {
    expect(() =>
      validateAppearance(appearance({ background: { kind: 'photo', assetId: '', maskStrength: 0.3 } })),
    ).toThrowError(/缺少图片标识/);
  });

  it('拒绝越界的渐变方向', () => {
    expect(() =>
      validateAppearance(
        appearance({ background: { kind: 'gradient', from: '#000000', to: '#ffffff', angle: 400 } }),
      ),
    ).toThrowError(/渐变方向/);
  });

  it('锁定配色必须提供种子色', () => {
    expect(() =>
      validateAppearance(
        appearance({ dynamicColor: { enabled: true, mode: 'locked', seed: null } }),
      ),
    ).toThrowError(/需要提供种子色/);
  });

  it('跟随背景时忽略残留的种子色', () => {
    const result = validateAppearance(
      appearance({ dynamicColor: { enabled: true, mode: 'follow', seed: '#123456' } }),
    );
    expect(result.dynamicColor).toEqual({ enabled: true, mode: 'follow', seed: '#123456' });
  });
});

describe('resolveSeed', () => {
  it('纯色背景直接使用背景色', () => {
    const result = resolveSeed(appearance({ background: { kind: 'solid', color: '#336699' } }));
    expect(result).toBe('#336699');
  });

  it('渐变背景取两个颜色的中点', () => {
    const result = resolveSeed(
      appearance({ background: { kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 } }),
    );
    expect(result).toBe('#808080');
  });

  it('手动锁定的种子色优先于背景', () => {
    const result = resolveSeed(
      appearance({
        background: { kind: 'solid', color: '#ffffff' },
        dynamicColor: { enabled: true, mode: 'locked', seed: '#101010' },
      }),
    );
    expect(result).toBe('#101010');
  });

  it('照片背景使用外部提取的种子色', () => {
    const result = resolveSeed(
      appearance({ background: { kind: 'photo', assetId: 'a1', maskStrength: 0.3 } }),
      '#445566',
    );
    expect(result).toBe('#445566');
  });

  it('默认背景没有取色来源，返回 null 以保留中性主题', () => {
    expect(resolveSeed(appearance())).toBeNull();
    expect(backgroundSeed({ kind: 'default' })).toBeNull();
  });
});
