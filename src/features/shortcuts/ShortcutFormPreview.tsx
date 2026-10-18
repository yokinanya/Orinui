import { FieldLegend, FieldSet } from '@/components/ui/field';
import { ShortcutIcon } from '@/features/shortcuts/ShortcutIcon';
import { ShortcutIconImage } from '@/features/shortcuts/ShortcutIconImage';
import { HOME_ICON_FRAME_SIZE, HOME_ICON_INSET, iconFrameStyle, iconGraphicStyle } from '@/features/shortcuts/icon-size-style';
import { useBlobUrl } from '@/hooks/use-local-image';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

/** 使用主页图标尺寸和内容占比；草稿图片只读取本地 Blob。 */
export function ShortcutFormPreview({ draft }: { readonly draft: ShortcutDraft }) {
  const imageUrl = useBlobUrl(draft.image?.blob ?? null);
  const shortcut = { id: 'form-preview', folderId: null, order: 0, title: draft.title, url: draft.url,
    icon: draft.icon.kind === 'asset' ? { ...draft.icon, color: draft.svgColor ?? undefined } : draft.icon, iconSourceUrl: draft.iconSourceUrl };
  const contentStyle = iconGraphicStyle({ frameSize: HOME_ICON_FRAME_SIZE, occupancy: draft.iconOccupancy, inset: HOME_ICON_INSET });
  return (
    <FieldSet className="min-w-0 gap-4 rounded-2xl border border-border bg-muted/30 p-5 md:sticky md:top-0">
      <FieldLegend variant="label">网站预览</FieldLegend>
      <div className="flex min-h-40 items-center justify-center" aria-label="网站实时预览">
        <div className="flex w-28 min-w-0 flex-col items-center gap-2 rounded-2xl p-2 text-center md:p-3">
          <span aria-hidden="true" style={iconFrameStyle()}
            className="flex shrink-0 items-center justify-center rounded-2xl border border-border bg-background font-medium text-foreground shadow-sm">
            {draft.image
              ? imageUrl && <ShortcutIconImage url={imageUrl} mime={draft.image.mime} color={draft.svgColor}
                  alt="" className="object-contain" style={contentStyle} />
              : <ShortcutIcon shortcut={shortcut} />}
          </span>
          <span className="block w-full min-w-0 truncate text-xs text-muted-foreground">
            {draft.displayName || '网站名称'}
          </span>
        </div>
      </div>
    </FieldSet>
  );
}
