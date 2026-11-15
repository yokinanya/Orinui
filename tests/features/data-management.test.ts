import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { BACKUP_VERSION } from '@/domain/backup';
import { toPortableSettings } from '@/domain/backup-settings';
import { createDefaultSettings } from '@/domain/settings';
import type { HomeData } from '@/domain/home';
import { readBackupFile } from '@/platform/backup-file';
import { BackupContentsPreview } from '@/features/settings/BackupContentsPreview';
import { BackupPanel } from '@/features/settings/BackupPanel';
import { ResetDataPanel } from '@/features/settings/ResetDataPanel';
import { DataManagementPanel } from '@/features/settings/DataManagementPanel';
import { SyncSettingsDisclosure } from '@/features/settings/SyncSettingsDisclosure';

vi.mock('@/app/data-context', () => ({ useData: () => ({}) }));
vi.mock('@/app/operations', () => ({ useOperations: () => ({ begin: vi.fn() }) }));
vi.mock('@/app/webdav-sync-context', () => ({ useWebDavSync: () => ({
  status: { state: 'synced' }, loading: false, busy: false, error: null,
}) }));
vi.mock('@/app/s3-sync-context', () => ({ useS3Sync: () => ({
  status: null, loading: false, busy: false, error: null,
}) }));
vi.mock('@/features/settings/WebDavSyncPanel', () => ({
  WebDavSyncPanel: () => createElement('input', { name: 'webdav-credentials' }),
}));
vi.mock('@/features/settings/S3SyncPanel', () => ({
  S3SyncPanel: () => createElement('input', { name: 's3-credentials' }),
}));
vi.mock('@/components/ui/alert-dialog', () => {
  const container = ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children);
  return Object.fromEntries(['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent',
    'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle'].map((key) => [key, container]));
});

async function readWidgetBackup(home?: HomeData) {
  // 清单设置整块不含 `bookmarks`，与导出端一致。
  const settings = toPortableSettings(createDefaultSettings());
  const manifest = { formatVersion: BACKUP_VERSION, exportedAt: '2026-10-25T00:00:00.000Z',
    folders: [], shortcuts: [], assets: [], settings: { ...settings, ...(home ? { home } : {}) } };
  const bytes = zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) });
  const file = Object.assign(new Blob([bytes.slice().buffer], { type: 'application/zip' }), { name: 'backup.zip' }) as File;
  return readBackupFile(file);
}

const HOME: HomeData = {
  placements: [
    { id: 'widget:note', column: 0, row: 0, height: 2 },
    { id: 'widget:todo', column: 1, row: 0, height: 2 },
    { id: 'widget:empty-todo', column: 0, row: 2, height: 2 },
  ],
  widgets: [
    { id: 'note', kind: 'note', text: '便签正文', items: [] },
    { id: 'todo', kind: 'todo', text: '', items: [
      { id: 'one', text: '未完成', completed: false, order: 0 },
      { id: 'two', text: '已完成', completed: true, order: 1 },
    ] },
    { id: 'empty-todo', kind: 'todo', text: '', items: [] },
  ],
};

describe('data management copy and backup preview', () => {
  it('counts parsed ZIP widgets rather than todo items, including empty lists', async () => {
    const backup = await readWidgetBackup(HOME);
    const markup = renderToStaticMarkup(createElement(BackupContentsPreview, { backup }));
    expect(markup).toContain('3 个小组件（1 个便签、2 个待办列表）');
    expect(backup.document.settings.home?.placements).toEqual(HOME.placements);
    expect(backup.document.settings.home?.widgets).toEqual(expect.arrayContaining([...HOME.widgets]));
    expect(Object.keys(backup.document).sort()).toEqual(['assets', 'exportedAt', 'folders', 'formatVersion', 'settings', 'shortcuts']);
  });

  it('shows zero widgets for an empty parsed ZIP', async () => {
    const backup = await readWidgetBackup();
    expect(renderToStaticMarkup(createElement(BackupContentsPreview, { backup })))
      .toContain('0 个小组件（0 个便签、0 个待办列表）');
  });

  it('describes complete library coverage and unencrypted ZIPs', () => {
    const markup = renderToStaticMarkup(createElement(BackupPanel));
    expect(markup).toContain('全库壁纸素材与图标、网站与文件夹、便签与待办、设置');
    expect(markup).toContain('ZIP 默认不加密');
  });

  it('explicitly warns that resetting deletes notes and todos', () => {
    const markup = renderToStaticMarkup(createElement(ResetDataPanel));
    expect(markup).toContain('本机网站、文件夹、便签与待办、全库壁纸素材与图标和设置都会删除');
    expect(markup).toContain('永久重置');
  });
});

describe('sync configuration disclosures', () => {
  it('keeps both provider panels mounted inside initially collapsed native details', () => {
    const markup = renderToStaticMarkup(createElement(DataManagementPanel));
    expect(markup.match(/<details\b/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<details[^>]*\bopen(?:=|\s|>)/);
    expect(markup).toContain('配置与连接 · 已同步');
    expect(markup).toContain('配置与连接 · 未连接');
    expect(markup).toMatch(/<details[^>]*>.*name="webdav-credentials".*<\/details>/);
    expect(markup).toMatch(/<details[^>]*>.*name="s3-credentials".*<\/details>/);
  });

  it.each([
    [{ status: null, loading: true, busy: false, error: null }, '正在读取同步状态…'],
    [{ status: null, loading: false, busy: true, error: null }, '处理中…'],
    [{ status: { state: 'pending' as const }, loading: false, busy: false, error: null }, '等待同步'],
    [{ status: { state: 'syncing' as const }, loading: false, busy: false, error: null }, '正在同步'],
    [{ status: { state: 'error' as const, error: '远端冲突' }, loading: false, busy: false, error: null }, '同步出错：远端冲突'],
    [{ status: { state: 'synced' as const }, loading: false, busy: false, error: '连接失败' }, '同步出错：连接失败'],
  ])('exposes current connection state even when collapsed: %s', (connection, label) => {
    const markup = renderToStaticMarkup(createElement(SyncSettingsDisclosure, { connection, children: '保留连接操作' }));
    expect(markup).toContain(`<summary`);
    expect(markup).toContain(label);
    expect(markup).toContain('保留连接操作');
  });
});
