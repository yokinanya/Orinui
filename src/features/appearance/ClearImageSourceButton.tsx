import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError } from '@/components/ui/field';
import { useData } from '@/app/data-context';

interface ClearImageSourceButtonProps {
  readonly assetId: string;
  readonly sourceUrl: string | null;
  readonly onCleared?: () => void;
  readonly disabled?: boolean;
}

export function ClearImageSourceButton({ assetId, sourceUrl, onCleared, disabled }: ClearImageSourceButtonProps) {
  const { clearImageSourceUrl } = useData();
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!sourceUrl || cleared) return null;

  const clear = async () => {
    setError(null);
    setBusy(true);
    try {
      await clearImageSourceUrl(assetId);
      setCleared(true);
      onCleared?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Field>
      <FieldDescription>清除立即保存，只移除来源地址，保留图片。</FieldDescription>
      <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => void clear()}>
        {busy ? '正在清除来源…' : '仅清除图片来源地址'}
      </Button>
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}
