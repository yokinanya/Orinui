import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';
import { BUILT_IN_ICONS } from '@/features/shortcuts/built-in-icons';
import { shortcutInitial } from '@/features/shortcuts/shortcut-initial';
import { useLocalImage } from '@/hooks/use-local-image';
import { shortcutIconOccupancy } from '@/domain/shortcut-icon';
import { HOME_ICON_FRAME_SIZE, HOME_ICON_INSET, iconGraphicStyle, iconLetterStyle } from '@/features/shortcuts/icon-size-style';
import { ShortcutIconImage } from '@/features/shortcuts/ShortcutIconImage';

export function ShortcutIcon({ shortcut }: { readonly shortcut: Shortcut }) {
  const image = useLocalImage(shortcut.icon.kind === 'asset' ? shortcut.icon.assetId : null);
  const occupancy = shortcutIconOccupancy(shortcut.icon);
  const contentStyle = { frameSize: HOME_ICON_FRAME_SIZE, occupancy, inset: HOME_ICON_INSET };
  if (shortcut.icon.kind === 'letter') return <span style={iconLetterStyle(contentStyle)}>{shortcutInitial(shortcutDisplayName(shortcut))}</span>;
  if (shortcut.icon.kind === 'built-in') {
    const { Icon } = BUILT_IN_ICONS[shortcut.icon.iconId];
    return <Icon aria-hidden="true" style={iconGraphicStyle(contentStyle)} />;
  }
  if (image.error) return <span title={image.error}>图标读取失败</span>;
  return image.url ? <ShortcutIconImage url={image.url} mime={image.mime ?? ''}
    color={shortcut.icon.color ?? null} alt="" className="object-contain"
    style={iconGraphicStyle(contentStyle)} /> : null;
}
