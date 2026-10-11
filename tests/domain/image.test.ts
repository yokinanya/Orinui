import { describe, expect, it } from 'vitest';
import { IMAGE_FILE_LIMIT, imageOutputSize, validateImageFile } from '@/domain/image';

describe('图片边界', () => {
  it('拒绝空文件、未知格式和超过原文件上限的文件', () => {
    expect(() => validateImageFile(new Blob([], { type: 'image/png' }))).toThrow(/为空/);
    expect(() => validateImageFile(new Blob(['x'], { type: 'image/gif' }))).toThrow(/只支持/);
    expect(() => validateImageFile({ type: 'image/png', size: IMAGE_FILE_LIMIT + 1 } as Blob)).toThrow(/10 MiB/);
  });
  it('按最长边等比例缩小，不放大小图', () => {
    expect(imageOutputSize({ width: 4000, height: 2000, kind: 'background' })).toEqual({ width: 2560, height: 1280 });
    expect(imageOutputSize({ width: 2000, height: 1000, kind: 'icon' })).toEqual({ width: 1024, height: 512 });
    expect(imageOutputSize({ width: 40, height: 20, kind: 'icon' })).toEqual({ width: 40, height: 20 });
  });
  it('SVG 输出也遵守 1024 最长边', () => {
    expect(imageOutputSize({ width: 2000, height: 1000, kind: 'background', svg: true })).toEqual({ width: 1024, height: 512 });
  });
  it.each([0, -1, NaN, Infinity, 1.5])('拒绝非法尺寸 %s', (width) => {
    expect(() => imageOutputSize({ width, height: 1, kind: 'icon' })).toThrow(/尺寸/);
  });
  it('背景与图标采用不同像素限制', () => {
    expect(() => imageOutputSize({ width: 7000, height: 6000, kind: 'background' })).toThrow(/40 MP/);
    expect(() => imageOutputSize({ width: 3000, height: 2000, kind: 'icon' })).toThrow(/4 MP/);
  });
});
