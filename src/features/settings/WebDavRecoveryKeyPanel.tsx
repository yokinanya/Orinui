import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { WebDavRecoveryKeyField } from '@/features/settings/WebDavRecoveryKeyField';

interface WebDavRecoveryKeyPanelProps {
  readonly value: string;
  readonly acknowledged: boolean;
  readonly disabled: boolean;
  readonly onAcknowledgedChange: (value: boolean) => void;
}

export function WebDavRecoveryKeyPanel({ value, acknowledged, disabled, onAcknowledgedChange }: WebDavRecoveryKeyPanelProps) {
  return (
    <section aria-labelledby="webdav-recovery-key-title" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 id="webdav-recovery-key-title" className="text-sm font-medium">保存恢复密钥</h4>
        <p className="text-xs text-muted-foreground">只显示一次，丢失后无法恢复数据。</p>
      </div>
      <WebDavRecoveryKeyField value={value} />
      <Field orientation="horizontal" className="gap-2" data-disabled={disabled}>
        <Checkbox id="webdav-key-acknowledged" checked={acknowledged} disabled={disabled}
          onCheckedChange={(checked) => onAcknowledgedChange(checked)} />
        <FieldLabel htmlFor="webdav-key-acknowledged">我已保存恢复密钥</FieldLabel>
      </Field>
    </section>
  );
}
