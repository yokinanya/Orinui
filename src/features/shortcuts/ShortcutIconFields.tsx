import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ShortcutIconChoices } from '@/features/shortcuts/ShortcutIconChoices';
import { ShortcutIconPreview } from '@/features/shortcuts/ShortcutIconPreview';
import { ShortcutIconOccupancyField } from '@/features/shortcuts/ShortcutIconOccupancyField';
import { ICON_PREVIEW_FRAME_SIZE } from '@/features/shortcuts/icon-size-style';
import { useShortcutIconSource } from '@/features/shortcuts/use-shortcut-icon-source';
import { useBlobUrl, useLocalImage } from '@/hooks/use-local-image';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

const DEFAULT_SVG_COLOR = '#000000';

function SvgColorField({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <Field>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor="shortcut-svg-color">SVG 图标颜色</FieldLabel>
        <div className="flex items-center gap-2">
          <ColorPicker id="shortcut-svg-color" label="SVG 图标颜色" value={draft.svgColor ?? DEFAULT_SVG_COLOR}
            disabled={draft.saving || draft.imageBusy} onChange={draft.setSvgColor} />
          <Button type="button" variant="ghost" size="sm" disabled={!draft.svgColor || draft.saving || draft.imageBusy}
            onClick={() => draft.setSvgColor(null)}>恢复原色</Button>
        </div>
      </div>
    </Field>
  );
}

function SavedAssetSource({ draft, source }: { readonly draft: ShortcutDraft; readonly source: ReturnType<typeof useShortcutIconSource> }) {
  if (draft.icon.kind !== 'asset' || draft.image) return null;
  return (
    <ClearImageSourceButton key={draft.icon.assetId} assetId={draft.icon.assetId} sourceUrl={source.sourceUrl}
      disabled={draft.saving || draft.imageBusy} onCleared={source.onCleared} />
  );
}

function SavedImageError({ message }: { readonly message: string | null }) {
  if (!message) return null;
  return <FieldError role="alert">{message}</FieldError>;
}

export function ShortcutIconFields({ draft }: { readonly draft: ShortcutDraft }) {
  const url = useBlobUrl(draft.image?.blob ?? null);
  const assetId = draft.icon.kind === 'asset' ? draft.icon.assetId : null;
  const saved = useLocalImage(assetId);
  const source = useShortcutIconSource({ draft, saved });
  const mime = draft.image?.mime ?? saved.mime;
  return (
    <FieldSet className="min-w-0 gap-4">
      <FieldLegend variant="label">图标</FieldLegend>
      <figure aria-label="图标预览" className="flex items-center gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-transparent"
          style={{ width: ICON_PREVIEW_FRAME_SIZE, height: ICON_PREVIEW_FRAME_SIZE }}>
          <ShortcutIconPreview draft={draft} url={url ?? saved.url} mime={mime} />
        </div>
        <ShortcutIconChoices draft={draft} />
      </figure>
      {mime === 'image/svg+xml' ? <SvgColorField draft={draft} /> : null}
      <SavedImageError message={saved.error} />
      <ShortcutIconOccupancyField draft={draft} />
      <RemoteImageDownload id="shortcut-image-url" kind="icon" disabled={draft.saving || draft.imageBusy} onBusyChange={draft.setImageBusy}
        initialSourceUrl={source.sourceUrl}
        onReady={(image) => { draft.selectRemoteImage(image); }} />
      <SavedAssetSource draft={draft} source={source} />
    </FieldSet>
  );
}
