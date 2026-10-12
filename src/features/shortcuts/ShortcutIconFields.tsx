import { FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { ShortcutIconChoices } from '@/features/shortcuts/ShortcutIconChoices';
import { BUILT_IN_ICONS } from '@/features/shortcuts/built-in-icons';
import { shortcutInitial } from '@/features/shortcuts/shortcut-initial';
import { useShortcutIconSource } from '@/features/shortcuts/use-shortcut-icon-source';
import { useBlobUrl, useLocalImage } from '@/hooks/use-local-image';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

function IconPreview({ draft, url }: { readonly draft: ShortcutDraft; readonly url: string | null }) {
  if (url) return <img src={url} alt="图标预览" className="size-16 rounded-2xl object-contain" />;
  if (draft.icon.kind === 'asset') return null;
  const Icon = draft.icon.kind === 'built-in' ? BUILT_IN_ICONS[draft.icon.iconId].Icon : null;
  return (
    <span role="img" aria-label={Icon ? '内置图形预览' : '名称首字母预览'}
      className="inline-flex size-16 items-center justify-center rounded-2xl bg-muted text-2xl text-foreground">
      {Icon ? <Icon aria-hidden="true" className="size-7" /> : shortcutInitial(draft.title)}
    </span>
  );
}

export function ShortcutIconFields({ draft }: { readonly draft: ShortcutDraft }) {
  const url = useBlobUrl(draft.image?.blob ?? null);
  const saved = useLocalImage(draft.icon.kind === 'asset' ? draft.icon.assetId : null);
  const source = useShortcutIconSource({ draft, saved });
  return (
    <FieldSet className="min-w-0 gap-4">
      <FieldLegend variant="label">图标</FieldLegend>
      <figure aria-label="图标预览" className="flex items-center gap-4">
        <IconPreview draft={draft} url={url ?? saved.url} />
        <ShortcutIconChoices draft={draft} />
      </figure>
      {saved.error && <FieldError role="alert">{saved.error}</FieldError>}
      <ImageUpload compact id="shortcut-image" kind="icon" disabled={draft.saving}
        onBusyChange={draft.setImageBusy} onReady={(image) => { draft.setImage(image); }} />
      <RemoteImageDownload id="shortcut-image-url" kind="icon" disabled={draft.saving} onBusyChange={draft.setImageBusy}
        initialSourceUrl={source.sourceUrl}
        onReady={(image) => { draft.selectRemoteImage(image); }} />
      {draft.icon.kind === 'asset' && !draft.image && (
        <ClearImageSourceButton key={draft.icon.assetId} assetId={draft.icon.assetId} sourceUrl={source.sourceUrl}
          disabled={draft.saving || draft.imageBusy} onCleared={source.onCleared} />
      )}
    </FieldSet>
  );
}
