import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { detectMotionMime } from '@/platform/media';
import { validateMotionRecord } from '@/domain/motion';
import type { MediaAsset } from '@/domain/asset';

const FORMATS = [
  ['mp4', 'video/mp4'], ['webm', 'video/webm'], ['gif', 'image/gif'], ['webp', 'image/webp'],
] as const;

describe('dynamic media boundaries', () => {
  it.each(FORMATS)('recognizes the actual %s file signature', async (extension, mime) => {
    const bytes = await readFile(new URL(`../fixtures/motion.${extension}`, import.meta.url));
    expect(await detectMotionMime(new Blob([bytes], { type: mime }))).toBe(mime);
  });
  it('rejects mismatched declarations and empty or arbitrary files', async () => {
    const bytes = await readFile(new URL('../fixtures/motion.mp4', import.meta.url));
    await expect(detectMotionMime(new Blob([bytes], { type: 'image/gif' }))).rejects.toThrow('不一致');
    await expect(detectMotionMime(new Blob())).rejects.toThrow('为空');
    await expect(detectMotionMime(new Blob(['not a video']))).rejects.toThrow('有效');
  });
  it('rejects remote, icon, mismatched kind and invalid duration metadata', () => {
    const asset: MediaAsset = { id: 'video', kind: 'background', mime: 'video/mp4', width: 320, height: 180,
      sourceUrl: null, blob: new Blob(['media'], { type: 'video/mp4' }), motion: { kind: 'video', duration: 2 } };
    expect(() => validateMotionRecord(asset)).not.toThrow();
    expect(() => validateMotionRecord({ ...asset, sourceUrl: 'https://example.com/video.mp4' })).toThrow('本地');
    expect(() => validateMotionRecord({ ...asset, kind: 'icon' })).toThrow('本地');
    expect(() => validateMotionRecord({ ...asset, motion: { kind: 'animation', duration: null } })).toThrow('不一致');
    expect(() => validateMotionRecord({ ...asset, motion: { kind: 'video', duration: Infinity } })).toThrow('时长');
  });
});
