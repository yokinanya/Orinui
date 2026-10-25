import { useRef, useState } from 'react';
import { newId } from '@/domain/id';
import type { HomeWidget } from '@/domain/home';
import type { WidgetDraft } from './widget-draft';
import { useUnsavedWarning } from './use-widget-draft';

export function useTodoAdd(widget: HomeWidget, draft: WidgetDraft) {
  const [text, setText] = useState('');
  const textRef = useRef(text);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useUnsavedWarning(Boolean(text) || Boolean(error));
  const change = (value: string) => { textRef.current = value; setText(value); };
  const add = async () => {
    if (pendingRef.current || !textRef.current.trim()) return;
    const submitted = textRef.current;
    pendingRef.current = true;
    setPending(true);
    setError(null);
    try {
      const saved = await draft.addItem({ id: newId(), text: submitted, completed: false,
        order: widget.items.reduce((max, item) => Math.max(max, item.order + 1), 0) });
      if (saved && textRef.current === submitted) change('');
    } catch (failure) { setError(failure); }
    finally { pendingRef.current = false; setPending(false); }
  };
  return { text, change, pending, error, add };
}
