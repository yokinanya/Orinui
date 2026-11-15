import { ExternalLinkIcon, InfoIcon } from 'lucide-react';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * 浏览器书签管理入口的手动指引。
 *
 * Chrome 的 `chrome://bookmarks` 是否可从扩展打开尚未经过真实扩展验证，因此这里不提供
 * 地址按钮，只给浏览器自带入口的键盘与菜单步骤；Firefox 同理。真实扩展验证通过前
 * 不得把这里描述成可点击的跳转。
 */
export function BookmarkManagerGuidance({ compact = false }: { readonly compact?: boolean }) {
  return (
    <div aria-label="在浏览器中管理书签的手动步骤" className={compact ? 'text-xs text-muted-foreground' : 'rounded-xl border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground'}>
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <InfoIcon aria-hidden="true" className="size-3.5" />
        在浏览器中管理书签
      </p>
      <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
        <li>Chrome：按 Ctrl+Shift+O 打开书签管理器，或在菜单中选择书签 → 书签管理器。</li>
        <li>Firefox：按 Ctrl+Shift+O 打开 Library，或在菜单中选择书签 → 管理书签。</li>
        <li>Orinui 只读显示浏览器内容；新增、改名、移动与删除都请在浏览器里完成。</li>
      </ul>
    </div>
  );
}

/**
 * 区域与文件夹弹层工具栏共用的入口。
 *
 * 按钮只就地展开手动步骤，不跳转到未验证的地址；展开状态用 `aria-expanded` 与
 * `aria-controls` 表达，键盘与读屏都能识别。
 */
export function BookmarkManagerGuidanceDisclosure({ tone = 'home' }: { readonly tone?: 'home' | 'panel' }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={tone === 'home' ? 'home-readable-focus min-h-9 text-glass-foreground-muted' : 'min-h-9 text-muted-foreground'}
        title="查看在浏览器中管理书签的步骤"
      >
        <ExternalLinkIcon aria-hidden="true" />
        在浏览器中管理
      </Button>
      {open && (
        <div id={panelId} className="w-full">
          <BookmarkManagerGuidance compact={tone === 'home'} />
        </div>
      )}
    </div>
  );
}
