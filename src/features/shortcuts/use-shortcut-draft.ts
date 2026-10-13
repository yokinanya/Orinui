import { useEffect, useEffectEvent, useState } from 'react';
import { useData } from '@/app/data-context';
import type { Shortcut } from '@/domain/shortcut';
import { useShortcutIconDraft } from '@/features/shortcuts/use-shortcut-icon-draft';

export interface ShortcutFormProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly groupId: string;
  readonly shortcut?: Shortcut;
}

export function useShortcutDraft({ open, onOpenChange, groupId, shortcut }: ShortcutFormProps) {
  const { createShortcut, updateShortcut } = useData();
  const [title, setTitle] = useState(shortcut?.title ?? '');
  const [url, setUrl] = useState(shortcut?.url ?? '');
  const iconDraft = useShortcutIconDraft(shortcut);
  const { icon, image, svgColor, iconSourceUrl } = iconDraft;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 元数据刷新不能覆盖正在编辑的草稿，只在打开或切换网站时初始化。
  const initialize = useEffectEvent(() => {
    setTitle(shortcut?.title ?? '');
    setUrl(shortcut?.url ?? '');
    iconDraft.initializeIcon(shortcut);
    setError(null);
  });
  useEffect(() => { if (open) initialize(); }, [open, shortcut?.id, groupId]);
  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const patch = { title, url, icon, image: image ?? undefined, iconSourceUrl, svgColor };
      if (shortcut) await updateShortcut(shortcut.id, patch);
      else await createShortcut({ groupId, ...patch });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return { title, setTitle, url, setUrl, ...iconDraft, error, saving, submit };
}

export type ShortcutDraft = ReturnType<typeof useShortcutDraft>;
