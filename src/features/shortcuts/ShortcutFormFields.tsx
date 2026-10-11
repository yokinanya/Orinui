import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/features/appearance/ImageUpload';
import { RemoteImageDownload } from '@/features/appearance/RemoteImageDownload';
import { ClearImageSourceButton } from '@/features/appearance/ClearImageSourceButton';
import { useBlobUrl, useLocalImage } from '@/hooks/use-local-image';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

const BUILT_IN_ICONS = [
  { id: 'compass', label: '罗盘' }, { id: 'book', label: '书本' },
  { id: 'briefcase', label: '公文包' }, { id: 'code', label: '代码' },
  { id: 'heart', label: '爱心' }, { id: 'sparkles', label: '星光' },
] as const;

function BuiltInIconChoices({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="内置图形">
      {BUILT_IN_ICONS.map(({ id, label }) => (
        <Button key={id} type="button" variant={draft.icon.kind === 'built-in' && draft.icon.iconId === id ? 'secondary' : 'outline'}
          aria-label={`使用${label}图标`} aria-pressed={draft.icon.kind === 'built-in' && draft.icon.iconId === id}
          disabled={draft.saving || draft.imageBusy} onClick={() => draft.chooseIcon({ kind: 'built-in', iconId: id })}>
          {label}
        </Button>
      ))}
    </div>
  );
}

function IconFields({ draft }: { readonly draft: ShortcutDraft }) {
  const url = useBlobUrl(draft.image?.blob ?? null);
  const saved = useLocalImage(draft.icon.kind === 'asset' ? draft.icon.assetId : null);
  const preview = url ?? saved.url;
  return (
    <FieldGroup>
      {preview && <img src={preview} alt="图标预览" className="size-12 rounded-2xl object-contain" />}
      {saved.error && <FieldError role="alert">{saved.error}</FieldError>}
      <ImageUpload id="shortcut-image" kind="icon" disabled={draft.saving}
        onBusyChange={draft.setImageBusy} onReady={(image) => { draft.setImage(image); }} />
      <RemoteImageDownload id="shortcut-image-url" kind="icon" disabled={draft.saving} onBusyChange={draft.setImageBusy}
        onReady={(image) => { draft.selectRemoteImage(image); }} />
      {draft.icon.kind === 'asset' && !draft.image && (
        <ClearImageSourceButton key={draft.icon.assetId} assetId={draft.icon.assetId} sourceUrl={draft.iconSourceUrl}
          disabled={draft.saving || draft.imageBusy}
          onCleared={() => draft.setIconSourceUrl(null)} />
      )}
      <Button type="button" variant="outline" disabled={draft.imageBusy || draft.saving} onClick={draft.resetIcon}>使用名称首字母</Button>
      <BuiltInIconChoices draft={draft} />
    </FieldGroup>
  );
}

export function ShortcutFormFields({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <FieldGroup className="py-4">
      <Field data-invalid={draft.error !== null || undefined}>
        <FieldLabel htmlFor="shortcut-title">名称</FieldLabel>
        <Input id="shortcut-title" value={draft.title} autoComplete="off" disabled={draft.saving}
          aria-invalid={draft.error !== null || undefined} onChange={(event) => draft.setTitle(event.target.value)} />
      </Field>
      <Field data-invalid={draft.error !== null || undefined}>
        <FieldLabel htmlFor="shortcut-url">网址</FieldLabel>
        <Input id="shortcut-url" value={draft.url} autoComplete="off" placeholder="example.com" disabled={draft.saving}
          aria-invalid={draft.error !== null || undefined} onChange={(event) => draft.setUrl(event.target.value)} />
        {draft.error && <FieldError role="alert">{draft.error}</FieldError>}
      </Field>
      <IconFields draft={draft} />
    </FieldGroup>
  );
}
