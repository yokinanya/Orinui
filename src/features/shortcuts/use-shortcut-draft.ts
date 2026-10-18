import { useEffect, useEffectEvent, useState } from 'react';
import { useData } from '@/app/data-context';
import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';
import { useShortcutIconDraft } from '@/features/shortcuts/use-shortcut-icon-draft';

export interface ShortcutFormProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 目标文件夹；null 表示放在主页网格 */
  readonly folderId: string | null;
  readonly shortcut?: Shortcut;
}

export function useShortcutDraft({ open, onOpenChange, folderId, shortcut }: ShortcutFormProps) {
  const { createShortcut, updateShortcut } = useData();
  const [title, setTitle] = useState(shortcut?.title ?? '');
  const [url, setUrl] = useState(shortcut?.url ?? '');
  const iconDraft = useShortcutIconDraft(shortcut);
  const { icon, image, svgColor, iconSourceUrl } = iconDraft;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** 新建时名称为空，显示用地址域名代替；图标预览也使用这个名称。 */
  const displayName = shortcutDisplayName({ title, url });
  // 元数据刷新不能覆盖正在编辑的草稿，只在打开或切换网站时初始化。
  const initialize = useEffectEvent(() => {
    setTitle(shortcut?.title ?? '');
    setUrl(shortcut?.url ?? '');
    iconDraft.initializeIcon(shortcut);
    setError(null);
  });
  useEffect(() => { if (open) initialize(); }, [open, shortcut?.id, folderId]);
  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      // 名称允许留空：显示时改用地址域名。图标优先按用户输入的名称取首字母。
      const patch = { title: title.trim(), url, icon, image: image ?? undefined, iconSourceUrl, svgColor };
      if (shortcut) await updateShortcut(shortcut.id, patch);
      else await createShortcut({ folderId, ...patch });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return { title, setTitle, url, setUrl, shortcut, displayName, ...iconDraft, error, saving, submit };
}

export type ShortcutDraft = ReturnType<typeof useShortcutDraft>;
