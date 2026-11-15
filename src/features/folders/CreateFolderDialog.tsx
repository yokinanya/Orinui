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

interface CreateFolderDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** 新文件夹所属层；缺省或 null 表示在主页顶层创建。 */
  readonly parentId?: string | null;
  /** 当前层名称，仅用于说明新文件夹会落在哪里。 */
  readonly parentName?: string;
}

/**
 * 在当前层新建文件夹。
 *
 * 名称校验与唯一性由领域层给出，这里只负责展示原因。`parentId` 决定归属层，
 * 不猜测、也不允许通过路径或名称推断。
 */
export function CreateFolderDialog({ open, onOpenChange, parentId = null, parentName }: CreateFolderDialogProps) {
  const { createFolder } = useData();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
  }, [open, parentId]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      // 顶层显式省略父标识，嵌套层传当前层 id；归属只由 parentId 决定，不做路径或名称推断。
      await createFolder(name, parentId ?? undefined);
      setName('');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const target = parentId === null ? '主页顶层' : `「${parentName ?? '当前文件夹'}」内`;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next); }}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>新文件夹会放在{target}。</DialogDescription>
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
