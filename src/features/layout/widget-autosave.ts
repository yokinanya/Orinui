import { WidgetDraft, WIDGET_SAVE_DEBOUNCE_MS, warnUnsaved } from './widget-draft';

export function startWidgetAutosave(draft: WidgetDraft) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    const state = draft.getSnapshot();
    if (!state.dirty || state.saving || state.error) return;
    timer = setTimeout(() => {
      void draft.flush().catch(() => { /* Rejection remains visible in the draft status; no automatic retry. */ });
    }, WIDGET_SAVE_DEBOUNCE_MS);
  };
  const unsubscribe = draft.subscribe(schedule);
  schedule();
  return () => { clearTimeout(timer); unsubscribe(); };
}

export function bindUnsavedWarning(target: Pick<Window, 'addEventListener' | 'removeEventListener'>) {
  target.addEventListener('beforeunload', warnUnsaved);
  return () => target.removeEventListener('beforeunload', warnUnsaved);
}
