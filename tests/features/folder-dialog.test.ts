import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Folder } from '@/domain/folder';

const folders: Folder[] = [
  { id: 'work', name: '工作', parentId: null, order: 0 },
  { id: 'project', name: '项目', parentId: 'work', order: 0 },
];

vi.mock('@/app/data-context', () => ({
  useData: () => ({ folders, loadFolderShortcuts: vi.fn(async () => []), settings: { home: { placements: [], widgets: [] } } }),
}));
// Base UI 的弹层依赖 portal 与浏览器环境，服务端渲染为空；这里只替换外壳，保留真实容器属性。
vi.mock('@/components/ui/dialog', () => {
  const container = ({ children, ...props }: { readonly children?: ReactNode }) =>
    createElement('div', props, children);
  return {
    Dialog: container, DialogContent: container, DialogHeader: container, DialogFooter: container,
    DialogDescription: container, DialogTitle: container,
  };
});
vi.mock('@/features/shortcuts/ShortcutFormDialog', () => ({ ShortcutFormDialog: () => null }));

const { FolderDialog } = await import('@/features/folders/FolderDialog');

/**
 * 首帧（读取尚未开始）必须显示加载占位，而不是空文件夹或 0 个网站。
 *
 * 这里是弹层真实渲染路径的唯一静态断言；成功/失败两种状态的判定由
 * `folder-read` 的单元测试覆盖，组件已把这两个决策点都委托给它。
 */
describe('FolderDialog 首帧不把未读取冒充为空文件夹', () => {
  it('显示加载占位、完整路径与 folder 数量，不显示空状态或 0 个网站', () => {
    const markup = renderToStaticMarkup(createElement(FolderDialog, {
      folder: folders[1]!, open: true, onOpenChange: vi.fn(),
    }));
    expect(markup).toContain('data-folder-dialog');
    expect(markup).toContain('data-folder-level="project"');
    expect(markup).toContain('data-folder-state="idle"');
    expect(markup).toContain('正在读取这个文件夹的网站…');
    expect(markup).toContain('正在读取网站…');
    expect(markup).toContain('0 个文件夹');
    expect(markup).not.toContain('这个文件夹是空的');
    expect(markup).not.toContain('0 个网站');
  });

  it('面包屑给出从主页到当前层的完整路径，返回按钮只在有父层时出现', () => {
    const nested = renderToStaticMarkup(createElement(FolderDialog, {
      folder: folders[1]!, open: true, onOpenChange: vi.fn(),
    }));
    expect(nested).toContain('aria-label="文件夹路径"');
    // 路径起点是主页；没有主页起点就只有 A/B，和搜索结果/视觉规格不一致。
    expect(nested).toContain('title="主页：关闭文件夹并回到主页"');
    expect(nested).toContain('>主页</button>');
    expect(nested).toContain('>工作</button>');
    expect(nested).toContain('aria-current="page"');
    expect(nested).toContain('aria-label="返回上一级"');
    // 真实路径文案顺序：主页 / 工作 / 项目（分隔符文本之间无额外空白）。
    expect(nested.replace(/<[^>]+>/g, '')).toMatch(/主页\/工作\/项目/u);

    const root = renderToStaticMarkup(createElement(FolderDialog, {
      folder: folders[0]!, open: true, onOpenChange: vi.fn(),
    }));
    expect(root).toContain('data-folder-level="work"');
    expect(root).toContain('>主页</button>');
    expect(root.replace(/<[^>]+>/g, '')).toMatch(/主页\/工作/u);
    expect(root).not.toContain('aria-label="返回上一级"');
  });
});
