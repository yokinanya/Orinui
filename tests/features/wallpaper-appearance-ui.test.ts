import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@/domain/asset';
import { createDefaultAppearance } from '@/domain/appearance';
import { BackgroundPanel } from '@/features/settings/BackgroundPanel';
import { DynamicColorPanel } from '@/features/settings/DynamicColorPanel';
import { WallpaperDetails } from '@/features/settings/WallpaperDetails';

const state = vi.hoisted(() => ({
  appearance: { theme: 'system', background: { kind: 'default' },
    dynamicColor: { enabled: true, mode: 'follow', seed: null } } as ReturnType<typeof createDefaultAppearance>,
  update: vi.fn(),
}));
vi.mock('@/features/settings/appearance-actions', () => ({
  useAppearanceActions: () => ({ appearance: state.appearance, update: state.update }),
}));
vi.mock('@/app/data-context', () => ({ useData: () => ({ settings: { appearance: state.appearance } }) }));
vi.mock('@/app/MotionPlayback', () => ({ useMotionPlayback: () => ({ reducedMotion: false }) }));
vi.mock('@/features/appearance/MotionPlaybackButton', () => ({
  MotionPlaybackButton: () => createElement('button', { 'aria-label': '暂停动态壁纸' }, 'playback'),
}));
vi.mock('@/features/settings/WallpaperPreview', () => ({
  WallpaperPreview: () => createElement('div', { 'data-preview': true }),
  WallpaperStatus: () => createElement('span', null, '已应用'),
}));
vi.mock('@/features/settings/WallpaperDetailsMenu', () => ({
  WallpaperDetailsMenu: () => createElement('button', { 'aria-label': '壁纸更多操作' }),
}));
vi.mock('@/features/settings/BackgroundMaskField', () => ({ BackgroundMaskField: () => null }));
vi.mock('@/features/appearance/RemoteImageDownload', () => ({ RemoteImageDownload: () => null }));
vi.mock('@/features/appearance/ColorPicker', () => ({
  ColorPicker: ({ label }: { readonly label: string }) => createElement('button', null, label),
}));

const photo: MediaAsset = { id: 'photo', kind: 'background', mime: 'image/png', width: 100, height: 100,
  blob: new Blob(['photo']), sourceUrl: null, name: '照片素材' };
const motion: MediaAsset = { ...photo, id: 'motion', mime: 'video/mp4', name: '动态素材',
  motion: { kind: 'video', duration: 10, poster: new Blob(['poster']) } };

function details(asset: MediaAsset, active: boolean) {
  return renderToStaticMarkup(createElement(WallpaperDetails, { asset, active, busy: false,
    onClose: vi.fn(), onActivate: vi.fn(), onDelete: vi.fn(), onRenameRequest: vi.fn() }));
}

beforeEach(() => { state.appearance = createDefaultAppearance(); state.update.mockClear(); });

describe('外观背景入口', () => {
  it('在外观页直接显示四种背景类型，不放上传输入', () => {
    const html = renderToStaticMarkup(createElement(BackgroundPanel, { onOpenLibrary: vi.fn() }));
    for (const label of ['默认', '纯色', '渐变', '壁纸']) expect(html).toContain(label);
    expect(html).not.toContain('type="file"');
    expect(state.update).not.toHaveBeenCalled();
  });
  it('当前动态背景统一使用壁纸入口，不重复实现动态类型', () => {
    state.appearance = { ...state.appearance, background: { kind: 'motion', assetId: motion.id, maskStrength: 0 } };
    const html = renderToStaticMarkup(createElement(BackgroundPanel, { onOpenLibrary: vi.fn() }));
    expect(html).toContain('打开壁纸库');
    expect(html).not.toContain('动态壁纸');
  });
  it('将动态配色开关与配色来源区分命名', () => {
    state.appearance = { ...state.appearance, dynamicColor: { enabled: true, mode: 'locked', seed: '#123456' } };
    const html = renderToStaticMarkup(createElement(DynamicColorPanel));
    for (const label of ['启用动态配色', '配色来源', '跟随背景', '手动选色', '主题色']) expect(html).toContain(label);
    expect(html).not.toContain('种子色');
  });
});

describe('壁纸详情播放和应用状态', () => {
  it('未应用动态素材不显示当前背景的播放按钮', () => {
    const html = details(motion, false);
    expect(html).not.toContain('暂停动态壁纸');
    expect(html).toContain('应用壁纸');
    expect(html).toContain('关闭壁纸详情');
    expect(html).not.toContain('返回素材列表');
  });
  it('已应用照片不显示动态播放控件，也不显示禁用应用按钮', () => {
    state.appearance = { ...state.appearance, background: { kind: 'photo', assetId: photo.id, maskStrength: 0 } };
    const html = details(photo, true);
    expect(html).not.toContain('暂停动态壁纸');
    expect(html).not.toContain('应用壁纸');
    expect(html).toContain('已应用');
  });
  it('仅已应用动态素材复用播放组件，并保留独立详情滚动区域', () => {
    state.appearance = { ...state.appearance, background: { kind: 'motion', assetId: motion.id, maskStrength: 0 } };
    const html = details(motion, true);
    expect(html.match(/暂停动态壁纸/g)).toHaveLength(1);
    expect(html).toContain('wallpaper-detail-content');
    expect(html).toContain('wallpaper-detail-preview');
    expect(html).toContain('壁纸更多操作');
  });
});
