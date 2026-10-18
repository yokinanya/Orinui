import { useState } from 'react';

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

interface CreateFolderDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** 新建文件夹。名称校验与唯一性由领域层给出，这里只负责展示原因。 */
export function CreateFolderDialog({ open, onOpenChange }: CreateFolderDialogProps) {
  const { createFolder } = useData();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await createFolder(name);
      setName('');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>输入文件夹名称。</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="folder-create-name">文件夹名称</FieldLabel>
              <Input id="folder-create-name" value={name} autoComplete="off" aria-invalid={error !== null || undefined}
                onChange={(event) => setName(event.target.value)} />
              {error !== null && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving}>{saving ? '创建中…' : '创建'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
