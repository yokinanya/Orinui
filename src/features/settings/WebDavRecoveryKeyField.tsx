import { useState } from 'react';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { writeClipboardText } from '@/platform/clipboard';

interface WebDavRecoveryKeyFieldProps {
  readonly value: string;
}

export function WebDavRecoveryKeyField({ value }: WebDavRecoveryKeyFieldProps) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyKey = async () => {
    setCopying(true);
    setCopied(false);
    setError(null);
    try {
      await writeClipboardText(value);
      setCopied(true);
    } catch (cause) {
      setError(`复制失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setCopying(false);
    }
  };

  return (
    <Field className="gap-2">
      <FieldLabel className="sr-only" htmlFor="webdav-new-recovery-key">恢复密钥</FieldLabel>
      <InputGroup>
        <InputGroupInput id="webdav-new-recovery-key" readOnly autoComplete="off" spellCheck={false}
          value={value} onFocus={(event) => event.currentTarget.select()} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" disabled={copying} aria-label={copied ? '已复制恢复密钥' : '复制恢复密钥'}
            title={copied ? '已复制' : '复制密钥'} onClick={() => void copyKey()}>
            {copied ? <CheckIcon data-icon="inline-end" aria-hidden="true" /> : <CopyIcon data-icon="inline-end" aria-hidden="true" />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <span className="sr-only" role="status">{copied ? '恢复密钥已复制' : ''}</span>
      {error ? <FieldError role="alert">{error}</FieldError> : null}
    </Field>
  );
}
