import type { Ref } from 'react';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { shortcutDisplayName } from '@/domain/shortcut';
import { ShortcutIconFields } from '@/features/shortcuts/ShortcutIconFields';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

export function ShortcutFormFields({ draft, urlRef }: { readonly draft: ShortcutDraft; readonly urlRef?: Ref<HTMLInputElement> }) {
  return (
    <FieldGroup className="min-w-0 gap-6">
      <FieldGroup className="min-w-0 gap-4">
        <Field data-invalid={draft.error !== null || undefined}>
          <FieldLabel htmlFor="shortcut-title">名称</FieldLabel>
          <Input id="shortcut-title" value={draft.title} autoComplete="off" disabled={draft.saving}
            placeholder={draft.url ? shortcutDisplayName({ title: '', url: draft.url }) : undefined}
            aria-invalid={draft.error !== null || undefined} onChange={(event) => draft.setTitle(event.target.value)} />
          <FieldDescription>留空时显示网站域名。</FieldDescription>
        </Field>
        <Field data-invalid={draft.error !== null || undefined}>
          <FieldLabel htmlFor="shortcut-url">网址</FieldLabel>
          <Input ref={urlRef} autoFocus id="shortcut-url" value={draft.url} autoComplete="off" placeholder="example.com" disabled={draft.saving}
            aria-invalid={draft.error !== null || undefined} onChange={(event) => draft.setUrl(event.target.value)} />
          {draft.error && <FieldError role="alert">{draft.error}</FieldError>}
        </Field>
      </FieldGroup>
      <ShortcutIconFields draft={draft} />
    </FieldGroup>
  );
}
