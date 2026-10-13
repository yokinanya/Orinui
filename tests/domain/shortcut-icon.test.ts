import { describe, expect, it } from 'vitest';
import { parseShortcutIcon, SHORTCUT_ICON_OCCUPANCY, shortcutIconOccupancy } from '@/domain/shortcut-icon';

describe('shortcut icon occupancy', () => {
  it('uses a 100% default and omits an explicit default', () => {
    expect(shortcutIconOccupancy(parseShortcutIcon({ kind: 'letter' }))).toBe(SHORTCUT_ICON_OCCUPANCY.default);
    expect(parseShortcutIcon({ kind: 'asset', assetId: 'icon-1', occupancy: 100 }))
      .toEqual({ kind: 'asset', assetId: 'icon-1' });
  });

  it('preserves valid non-default occupancy on every icon variant', () => {
    expect(parseShortcutIcon({ kind: 'letter', occupancy: 75 })).toEqual({ kind: 'letter', occupancy: 75 });
    expect(parseShortcutIcon({ kind: 'built-in', iconId: 'heart', occupancy: 50 }))
      .toEqual({ kind: 'built-in', iconId: 'heart', occupancy: 50 });
    expect(parseShortcutIcon({ kind: 'asset', assetId: 'icon-1', occupancy: 64 }))
      .toEqual({ kind: 'asset', assetId: 'icon-1', occupancy: 64 });
  });

  it.each([49, 101, 50.5, Number.NaN, '75'])('rejects invalid explicit occupancy %s', (occupancy) => {
    expect(() => parseShortcutIcon({ kind: 'letter', occupancy })).toThrow(/图标占比/);
  });

  it('converts old pixel sizes to occupancy percentages', () => {
    expect(parseShortcutIcon({ kind: 'letter', size: 24 })).toEqual({ kind: 'letter', occupancy: 50 });
    expect(parseShortcutIcon({ kind: 'built-in', iconId: 'heart', size: 30 }))
      .toEqual({ kind: 'built-in', iconId: 'heart', occupancy: 63 });
    expect(parseShortcutIcon({ kind: 'asset', assetId: 'icon-1', size: 48 }))
      .toEqual({ kind: 'asset', assetId: 'icon-1' });
    expect(parseShortcutIcon({ kind: 'asset', assetId: 'icon-2', size: 64 }))
      .toEqual({ kind: 'asset', assetId: 'icon-2' });
  });

  it.each([23, 65, 24.5, Number.NaN, '32'])('rejects invalid legacy size %s', (size) => {
    expect(() => parseShortcutIcon({ kind: 'letter', size })).toThrow(/旧版图标尺寸/);
  });

  it('rejects unknown fields, conflicting occupancy representations, and invalid icon identifiers', () => {
    expect(() => parseShortcutIcon({ kind: 'letter', width: 32 })).toThrow(/字段/);
    expect(() => parseShortcutIcon({ kind: 'letter', occupancy: undefined })).toThrow(/图标占比/);
    expect(() => parseShortcutIcon({ kind: 'letter', size: 36, occupancy: 75 })).toThrow(/同时包含/);
    expect(() => parseShortcutIcon({ kind: 'built-in', iconId: 'unknown' })).toThrow(/标识/);
    expect(() => parseShortcutIcon({ kind: 'asset', assetId: '' })).toThrow(/不能为空/);
    expect(() => parseShortcutIcon({ kind: 'asset', assetId: ' asset ' })).toThrow(/首尾空白/);
  });

  it('allows canonical SVG color only on asset icons', () => {
    expect(parseShortcutIcon({ kind: 'asset', assetId: 'svg-1', color: '#12abef', occupancy: 78 }))
      .toEqual({ kind: 'asset', assetId: 'svg-1', color: '#12abef', occupancy: 78 });
    expect(() => parseShortcutIcon({ kind: 'letter', color: '#12abef' })).toThrow(/字段/);
    expect(() => parseShortcutIcon({ kind: 'built-in', iconId: 'heart', color: '#12abef' })).toThrow(/字段/);
    expect(() => parseShortcutIcon({ kind: 'asset', assetId: 'svg-1', color: '#ABCDEF' })).toThrow(/小写/);
  });
});
