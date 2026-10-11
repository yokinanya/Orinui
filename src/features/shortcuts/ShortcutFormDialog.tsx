import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ShortcutFormFields } from '@/features/shortcuts/ShortcutFormFields';
import { useShortcutDraft, type ShortcutFormProps } from '@/features/shortcuts/use-shortcut-draft';

/** 图片保留在草稿中，保存时与网站记录一起事务化写入。 */
export function ShortcutFormDialog(props: ShortcutFormProps) {
  const { open, onOpenChange, shortcut } = props;
  const draft = useShortcutDraft(props);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!draft.saving) onOpenChange(next); }}>
      <DialogContent>
        <form className="max-h-[calc(100dvh-3rem)] overflow-y-auto"
          onSubmit={(event) => { event.preventDefault(); if (!draft.saving && !draft.imageBusy) void draft.submit(); }}>
          <DialogHeader>
            <DialogTitle>{shortcut ? '编辑网站' : '添加网站'}</DialogTitle>
            <DialogDescription>网址缺少协议时会补 https。上传图片在保存时写入；清除已有图片来源立即生效，取消编辑不会恢复来源。</DialogDescription>
          </DialogHeader>
          <ShortcutFormFields draft={draft} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={draft.saving} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={draft.saving || draft.imageBusy}>{draft.saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
