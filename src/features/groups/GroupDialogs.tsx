import { useEffect, useState } from 'react';

import { useData } from '@/app/data-context';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import type { Group } from '@/domain/group';
import { notifyError } from '@/lib/notify';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface GroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 新建分组。名称校验与唯一性由领域层给出，这里只负责展示原因。 */
export function CreateGroupDialog({ open, onOpenChange }: GroupFormDialogProps) {
  const { createGroup } = useData();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError(null);
  }, [open]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await createGroup(name);
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
            <DialogTitle>新建分组</DialogTitle>
            <DialogDescription>分组用于归类网站，在主页标签行按这里的顺序排列。</DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="group-create-name">分组名称</FieldLabel>
              <Input
                id="group-create-name"
                value={name}
                autoComplete="off"
                aria-invalid={error !== null || undefined}
                onChange={(event) => setName(event.target.value)}
              />
              {error !== null && <FieldError>{error}</FieldError>}
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '创建中…' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RenameGroupDialogProps extends GroupFormDialogProps {
  group: Group;
}

/** 重命名分组。标签行空间紧凑，因此用对话框而不是行内输入框。 */
export function RenameGroupDialog({ group, open, onOpenChange }: RenameGroupDialogProps) {
  const { renameGroup } = useData();
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group.name);
    setError(null);
  }, [open, group.name]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      await renameGroup(group.id, name);
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
            <DialogTitle>重命名分组</DialogTitle>
            <DialogDescription>改名不会影响组内网站。</DialogDescription>
          </DialogHeader>

          <FieldGroup className="py-4">
            <Field data-invalid={error !== null || undefined}>
              <FieldLabel htmlFor="group-rename-name">分组名称</FieldLabel>
              <Input
                id="group-rename-name"
                value={name}
                autoComplete="off"
                aria-invalid={error !== null || undefined}
                onChange={(event) => setName(event.target.value)}
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

interface DeleteGroupDialogProps extends GroupFormDialogProps {
  group: Group;
}

/**
 * 删除分组前的二次确认。
 *
 * 打开时统计组内网站数量并写进说明：整组删除不可撤销，必须让用户在确认前看到代价。
 */
export function DeleteGroupDialog({ group, open, onOpenChange }: DeleteGroupDialogProps) {
  const { deleteGroup, countShortcutsInGroup } = useData();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setCount(null);
    void countShortcutsInGroup(group.id)
      .then((value) => {
        if (!cancelled) setCount(value);
      })
      .catch(notifyError);

    return () => {
      cancelled = true;
    };
  }, [open, group.id, countShortcutsInGroup]);

  const confirm = () => {
    void (async () => {
      try {
        await deleteGroup(group.id);
        onOpenChange(false);
      } catch (cause) {
        notifyError(cause);
      }
    })();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除分组「{group.name}」？</AlertDialogTitle>
          <AlertDialogDescription>
            该分组以及组内的 {count ?? 0} 个网站会被永久删除，此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={confirm}>删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
