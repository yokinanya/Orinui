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
import type { Folder } from '@/domain/folder';
import { folderPathLabel } from '@/features/folders/folder-path';

interface FolderNameDialogProps {
  readonly folder: Folder;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * 重命名文件夹。名称唯一性与长度由领域层校验，这里只展示原因。
 * 只改名称，不改变所属层或同层顺序；完整路径用于区分同名文件夹。
 */
export function RenameFolderDialog({ folder, open, onOpenChange }: FolderNameDialogProps) {
  const { folders, renameFolder } = useData();
  const [name, setName] = useState(folder.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(folder.name);
    setError(null);
  }, [open, folder.name]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await renameFolder(folder.id, name);
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <DialogHeader>
            <DialogTitle>重命名文件夹</DialogTitle>
            <DialogDescription>
              路径：{folderPathLabel(folders, folder.id)}。只改名称，不改变所属层或顺序。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="folder-rename-name">文件夹名称</FieldLabel>
              <Input id="folder-rename-name" value={name} autoComplete="off" aria-invalid={error !== null || undefined}
                onChange={(event) => setName(event.target.value)} />
              {error !== null && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
