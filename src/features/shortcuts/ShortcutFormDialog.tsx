import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import type { Shortcut } from '@/domain/shortcut';

interface ShortcutFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  /** 传入表示编辑已有网站，不传表示新增。 */
  shortcut?: Shortcut | undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 新增或编辑网站。
 *
 * 字段编辑在草稿态进行，点“保存”才校验并写入；失败时把领域层给出的原因
 * 显示在对应字段上，不关闭对话框也不保留半成品数据。
 */
export function ShortcutFormDialog({
  open,
  onOpenChange,
  groupId,
  shortcut,
}: ShortcutFormDialogProps) {
  const { createShortcut, updateShortcut } = useData();
  const [title, setTitle] = useState(shortcut?.title ?? '');
  const [url, setUrl] = useState(shortcut?.url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(shortcut?.title ?? '');
    setUrl(shortcut?.url ?? '');
    setError(null);
  }, [open, shortcut]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      if (shortcut) {
        await updateShortcut(shortcut.id, { title, url });
      } else {
        await createShortcut({ groupId, title, url });
      }
      onOpenChange(false);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{shortcut ? '编辑网站' : '添加网站'}</DialogTitle>
            <DialogDescription>名称用于显示，网址缺少协议时会自动补 https。</DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="shortcut-title">名称</FieldLabel>
              <Input
                id="shortcut-title"
                value={title}
                autoComplete="off"
                aria-invalid={error !== null || undefined}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="shortcut-url">网址</FieldLabel>
              <Input
                id="shortcut-url"
                value={url}
                autoComplete="off"
                placeholder="example.com"
                aria-invalid={error !== null || undefined}
                onChange={(event) => setUrl(event.target.value)}
              />
              {error !== null && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
