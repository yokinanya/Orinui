import { useTodoAdd } from './use-todo-add';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import type { HomeWidget, TodoItem } from '@/domain/home';
import type { WidgetDraft } from './widget-draft';

interface TodoProps {
  readonly widget: HomeWidget;
  readonly draft: WidgetDraft;
  readonly flush: () => void;
}
export function TodoWidget({ widget, draft, flush }: TodoProps) {
  const { text, change, pending, error, add } = useTodoAdd(widget, draft);
  return <>
    <div className="min-h-0 flex-1 overflow-y-auto"><FieldGroup className="gap-2">
      {widget.items.toSorted((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((item) =>
        <TodoRow key={item.id} item={item} draft={draft} flush={flush} />)}
    </FieldGroup></div>
    <form onSubmit={(event) => { event.preventDefault(); void add(); }} className="flex gap-2">
      <Field><FieldLabel className="sr-only" htmlFor={`todo-new-${widget.id}`}>新待办</FieldLabel>
        <Input id={`todo-new-${widget.id}`} value={text} onChange={(event) => change(event.target.value)} placeholder="新待办" /></Field>
      <Button type="submit" size="sm" variant="secondary" disabled={pending || !text.trim()}>{pending ? '添加中…' : '添加'}</Button>
    </form>
    {Boolean(error) && <div role="alert" className="text-xs text-muted-foreground">
      未保存：{error instanceof Error ? error.message : String(error)}
      <Button variant="ghost" size="sm" disabled={pending || !text.trim()} onClick={() => void add()}>重试添加</Button>
    </div>}
  </>;
}
function TodoRow({ item, draft, flush }: { readonly item: TodoItem; readonly draft: WidgetDraft; readonly flush: () => void }) {
  return <Field orientation="horizontal">
    <Checkbox aria-label={`完成 ${item.text}`} checked={item.completed} onCheckedChange={(completed) => {
      draft.changeItem(item.id, { completed }); flush();
    }} />
    <Input aria-label="待办内容" value={item.text} onChange={(event) => draft.changeItem(item.id, { text: event.target.value })} onBlur={flush} />
    <Button variant="ghost" size="sm" aria-label={`删除待办 ${item.text}`} onClick={() => { draft.removeItem(item.id); flush(); }}>删除</Button>
  </Field>;
}
