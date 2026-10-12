import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ShortcutIconFields } from '@/features/shortcuts/ShortcutIconFields';
import type { ShortcutDraft } from '@/features/shortcuts/use-shortcut-draft';

export function ShortcutFormFields({ draft }: { readonly draft: ShortcutDraft }) {
  return (
    <FieldGroup className="grid gap-6 landscape:md:grid-cols-2">
      <FieldGroup className="min-w-0 gap-4">
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
      </FieldGroup>
      <ShortcutIconFields draft={draft} />
    </FieldGroup>
  );
}
