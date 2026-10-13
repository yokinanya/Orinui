import { useState } from 'react';
import { Link2OffIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldError } from '@/components/ui/field';
import { useData } from '@/app/data-context';

interface ClearImageSourceButtonProps {
  readonly assetId: string;
  readonly sourceUrl: string | null;
  readonly onCleared?: () => void;
  readonly disabled?: boolean;
  readonly iconOnly?: boolean;
}

export function ClearImageSourceButton({ assetId, sourceUrl, onCleared, disabled, iconOnly = false }: ClearImageSourceButtonProps) {
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

  const buttonLabel = busy ? '正在清除来源' : '清除来源';
  const button = (
    <Button type="button" variant={iconOnly ? 'ghost' : 'outline'} size={iconOnly ? 'icon-sm' : 'default'}
      aria-label={iconOnly ? buttonLabel : undefined} title={iconOnly ? buttonLabel : undefined}
      disabled={busy || disabled} onClick={() => void clear()}>
      {iconOnly ? busy ? <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        : <Link2OffIcon aria-hidden="true" /> : buttonLabel}
    </Button>
  );

  if (iconOnly) {
    return (
      <div className="flex items-center gap-2">
        {button}
        {error && <FieldError role="alert" className="max-w-48">{error}</FieldError>}
      </div>
    );
  }

  return (
    <Field>
      {button}
      {error && <FieldError role="alert">{error}</FieldError>}
    </Field>
  );
}
