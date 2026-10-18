import { BUILT_IN_ICONS } from '@/features/shortcuts/built-in-icons';
import { shortcutInitial } from '@/features/shortcuts/shortcut-initial';
import { ICON_PREVIEW_FRAME_SIZE, ICON_PREVIEW_INSET, iconGraphicStyle, iconLetterStyle } from '@/features/shortcuts/icon-size-style';
import { ShortcutIconImage } from '@/features/shortcuts/ShortcutIconImage';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';
import { shortcutIconOccupancy } from '@/domain/shortcut-icon';

export function ShortcutIconPreview({ draft, url, mime }: {
  readonly draft: ShortcutDraft;
  readonly url: string | null;
  readonly mime: string | null;
}) {
  const style = iconGraphicStyle({ frameSize: ICON_PREVIEW_FRAME_SIZE, occupancy: draft.iconOccupancy, inset: ICON_PREVIEW_INSET });
  if (url) return <ShortcutIconImage url={url} mime={mime ?? ''} color={draft.svgColor}
    alt="图标预览" className="object-contain" style={style} />;
  if (draft.icon.kind === 'asset') return null;
  const Icon = draft.icon.kind === 'built-in' ? BUILT_IN_ICONS[draft.icon.iconId].Icon : null;
  const occupancy = shortcutIconOccupancy(draft.icon);
  const frame = { frameSize: ICON_PREVIEW_FRAME_SIZE, occupancy, inset: ICON_PREVIEW_INSET };
  if (Icon) return (
    <span role="img" aria-label="内置图形预览" style={iconGraphicStyle(frame)}
      className="flex items-center justify-center text-foreground">
      <Icon aria-hidden="true" className="size-full" />
    </span>
  );
  return <span role="img" aria-label="名称首字母预览" style={iconLetterStyle(frame)}>{shortcutInitial(draft.displayName)}</span>;
}
