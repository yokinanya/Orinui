import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HomeWidget } from '@/domain/home';
import { WidgetDraft } from './widget-draft';
import { bindUnsavedWarning, startWidgetAutosave } from './widget-autosave';

export function useWidgetDraft(widget: HomeWidget, save: (widget: HomeWidget) => Promise<void>) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const [draft] = useState(() => new WidgetDraft(widget, (next) => saveRef.current(next)));
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  useEffect(() => draft.receive(widget), [draft, widget]);
  useEffect(() => startWidgetAutosave(draft), [draft]);
  const flush = () => { void draft.flush().catch(() => { /* Error is exposed in the draft status. */ }); };
  return { ...state, draft, flush };
}

export function useUnsavedWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    return bindUnsavedWarning(window);
  }, [unsaved]);
}
