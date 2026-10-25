import { useState } from 'react';
import { useData } from '@/app/data-context';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TodoWidget } from './TodoWidget';
import { useWidgetDraft, useUnsavedWarning } from './use-widget-draft';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter } from '@/components/ui/alert-dialog';
import type { HomeWidget } from '@/domain/home';
import { notifyError } from '@/lib/notify';

export function Widget({ widget, editing }: { readonly widget: HomeWidget; readonly editing: boolean }) {
  const { saveWidget, deleteWidget } = useData();
  const state = useWidgetDraft(widget, saveWidget);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  useUnsavedWarning(state.dirty || state.saving || Boolean(state.error));
  const remove = async () => {
    setPending(true);
    try { await state.draft.flush(); await deleteWidget(widget.id); setDeleting(false); } catch (error) { notifyError(error); }
    finally { setPending(false); }
  };
  return <section aria-label={widget.kind === 'note' ? '便签' : '待办'} className="home-widget flex h-full min-h-0 flex-col gap-2 rounded-2xl border border-border bg-card p-3 text-card-foreground">
    <header className="flex items-center justify-between gap-2"><span>{widget.kind === 'note' ? '便签' : '待办'}</span>
      {editing && <Button size="sm" variant="ghost" onPointerDown={state.flush} onClick={() => setDeleting(true)}>删除</Button>}</header>
    {widget.kind === 'note' ? <Textarea aria-label="便签内容" className="min-h-0 flex-1 resize-none" value={state.widget.text}
      onChange={(event) => state.draft.setText(event.target.value)} onBlur={state.flush} />
      : <TodoWidget widget={state.widget} draft={state.draft} flush={state.flush} />}
    <div role={state.error ? 'alert' : 'status'} className="text-xs text-muted-foreground" aria-live="polite">
      {state.error ? <>未保存：{state.error instanceof Error ? state.error.message : String(state.error)}
        <Button variant="ghost" size="sm" disabled={state.saving} onClick={state.flush}>重试</Button></>
        : state.saving ? '保存中…' : state.dirty ? '未保存' : null}
    </div>
    <AlertDialog open={deleting} onOpenChange={(open) => { if (!pending) setDeleting(open); }}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除小组件？</AlertDialogTitle>
        <AlertDialogDescription>此小组件及其中全部内容将被删除，无法撤销；启用同步时也会同步删除。</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><Button variant="outline" disabled={pending} onClick={() => setDeleting(false)}>取消</Button>
          <Button variant="destructive" disabled={pending} onClick={() => void remove()}>确认删除</Button></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
