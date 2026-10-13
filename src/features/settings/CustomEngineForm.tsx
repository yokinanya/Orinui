import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useData } from '@/app/data-context';
import { LIMITS } from '@/domain/limits';

export function CustomEngineForm() {
  const { createSearchEngine, settings } = useData();
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    try {
      await createSearchEngine({ name, template });
      setName('');
      setTemplate('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <FieldGroup>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="engine-name">名称</FieldLabel>
          <Input id="engine-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field data-invalid={error !== null || undefined}>
          <FieldLabel htmlFor="engine-template">HTTPS 搜索模板</FieldLabel>
          <Input id="engine-template" value={template} placeholder="https://example.com/search?q={query}"
            onChange={(event) => setTemplate(event.target.value)} />
          <FieldDescription>使用 HTTPS，并在搜索词位置填入 {'{query}'}。</FieldDescription>
          {error && <FieldError role="alert">{error}</FieldError>}
        </Field>
        <Button type="submit" disabled={settings.search.customEngines.length >= LIMITS.customEngines}>添加搜索引擎</Button>
      </FieldGroup>
    </form>
  );
}
