import type { Shortcut } from '@/domain/shortcut';
import { BUILT_IN_ICONS } from '@/features/shortcuts/built-in-icons';
import { shortcutInitial } from '@/features/shortcuts/shortcut-initial';
import { useLocalImage } from '@/hooks/use-local-image';

export function ShortcutIcon({ shortcut }: { readonly shortcut: Shortcut }) {
  const image = useLocalImage(shortcut.icon.kind === 'asset' ? shortcut.icon.assetId : null);
  if (shortcut.icon.kind === 'letter') return shortcutInitial(shortcut.title);
  if (shortcut.icon.kind === 'built-in') {
    const { Icon } = BUILT_IN_ICONS[shortcut.icon.iconId];
    return <Icon aria-hidden="true" className="size-7" />;
  }
  if (image.error) return <span title={image.error}>图标读取失败</span>;
  return image.url ? <img src={image.url} alt="" className="size-full rounded-2xl object-contain" /> : null;
}
