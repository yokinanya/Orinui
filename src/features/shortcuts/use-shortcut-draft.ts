import { useEffect, useState } from 'react';
import { useData } from '@/app/data-context';
import type { Shortcut, ShortcutIcon } from '@/domain/shortcut';
import type { NewImageAsset } from '@/storage/assets';

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
  const [icon, setIcon] = useState<ShortcutIcon>(shortcut?.icon ?? { kind: 'letter' });
  const [iconSourceUrl, setIconSourceUrl] = useState(shortcut?.iconSourceUrl ?? null);
  const [image, setImage] = useState<NewImageAsset | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(shortcut?.title ?? '');
    setUrl(shortcut?.url ?? '');
    setIcon(shortcut?.icon ?? { kind: 'letter' });
    setIconSourceUrl(shortcut?.iconSourceUrl ?? null);
    setImage(null);
    setImageBusy(false);
    setError(null);
  }, [open, shortcut]);
  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const patch = { title, url, icon, image: image ?? undefined, iconSourceUrl: icon.kind === 'letter' ? null : iconSourceUrl };
      if (shortcut) await updateShortcut(shortcut.id, patch);
      else await createShortcut({ groupId, ...patch });
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  const chooseIcon = (next: ShortcutIcon) => { setImage(null); setIconSourceUrl(null); setIcon(next); };
  const selectLocalImage = (next: NewImageAsset) => { setImage(next); setIconSourceUrl(null); };
  const selectRemoteImage = (next: NewImageAsset) => { setImage(next); setIconSourceUrl(next.sourceUrl ?? null); };
  const resetIcon = () => chooseIcon({ kind: 'letter' });
  return { title, setTitle, url, setUrl, icon, image, iconSourceUrl, setIconSourceUrl, imageBusy, setImage: selectLocalImage, setImageBusy, error, saving, submit, resetIcon, chooseIcon, selectRemoteImage };
}

export type ShortcutDraft = ReturnType<typeof useShortcutDraft>;
