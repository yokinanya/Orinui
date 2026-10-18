import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FloatingDialogContent,
} from '@/components/ui/dialog';
import { ShortcutFormFields } from '@/features/shortcuts/ShortcutFormFields';
import type { ShortcutFormProps } from '@/features/shortcuts/use-shortcut-draft';
import { useShortcutFormDraft } from '@/features/shortcuts/useShortcutFormDraft';
import { ShortcutFormPreview } from '@/features/shortcuts/ShortcutFormPreview';

/** 图片保留在草稿中，保存时与网站记录一起事务化写入。 */
export function ShortcutFormDialog(props: ShortcutFormProps) {
  const { open, onOpenChange, shortcut } = props;
  const { draft, formVersion, urlRef, saveAndContinue } = useShortcutFormDraft(props);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!draft.saving) onOpenChange(next); }}>
      <FloatingDialogContent className="gap-0 p-0 sm:max-w-xl md:max-w-3xl">
        <form className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col"
          onSubmit={(event) => { event.preventDefault(); if (!draft.saving && !draft.imageBusy) void draft.submit(); }}>
          <DialogHeader className="shrink-0 px-6 pt-6">
            <DialogTitle>{shortcut ? '编辑网站' : '添加网站'}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.7fr)]">
              <ShortcutFormFields key={formVersion} draft={draft} urlRef={urlRef} />
              <ShortcutFormPreview draft={draft} />
            </div>
          </div>
          <DialogFooter className="shrink-0 px-6 pb-6">
            <Button type="button" variant="ghost" disabled={draft.saving} onClick={() => onOpenChange(false)}>取消</Button>
            {!shortcut && <Button type="button" variant="outline" disabled={draft.saving || draft.imageBusy}
              onClick={() => { void saveAndContinue(); }}>保存并继续添加</Button>}
            <Button type="submit" disabled={draft.saving || draft.imageBusy}>{draft.saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </FloatingDialogContent>
    </Dialog>
  );
}
