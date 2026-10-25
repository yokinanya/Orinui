import type { HomeWidget, TodoItem } from '@/domain/home';

export const WIDGET_SAVE_DEBOUNCE_MS = 600;
type Save = (widget: HomeWidget) => Promise<void>;
export interface WidgetDraftState {
  readonly widget: HomeWidget;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly error: unknown;
}
const same = (a: HomeWidget, b: HomeWidget) => JSON.stringify(a) === JSON.stringify(b);

/** Preserve locally changed fields while accepting unrelated incoming fields. */
function mergeDraft(base: HomeWidget, draft: HomeWidget, incoming: HomeWidget): HomeWidget {
  const items = incoming.items.filter((item) => !base.items.some(({ id }) => id === item.id)
    || draft.items.some(({ id }) => id === item.id)).map((item) => {
    const before = base.items.find(({ id }) => id === item.id);
    const local = draft.items.find(({ id }) => id === item.id);
    if (!before || !local) return item;
    return { ...item, text: local.text !== before.text ? local.text : item.text,
      completed: local.completed !== before.completed ? local.completed : item.completed };
  });
  const added = draft.items.filter((item) => !base.items.some(({ id }) => id === item.id)
    && !items.some(({ id }) => id === item.id));
  return { ...incoming, text: draft.text !== base.text ? draft.text : incoming.text, items: [...items, ...added] };
}

export class WidgetDraft {
  private saved: HomeWidget;
  private state: WidgetDraftState;
  private readonly listeners = new Set<() => void>();
  private readonly echoes = new Set<string>();
  private running: Promise<void> | undefined;
  private adding = false;
  constructor(widget: HomeWidget, private readonly save: Save) {
    this.saved = widget;
    this.state = { widget, dirty: false, saving: false, error: null };
    this.echoes.add(JSON.stringify(widget));
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<WidgetDraftState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  receive(widget: HomeWidget) {
    if (this.echoes.has(JSON.stringify(widget))) return;
    const draft = mergeDraft(this.saved, this.state.widget, widget);
    this.saved = widget;
    this.echoes.add(JSON.stringify(widget));
    this.publish({ widget: draft, dirty: !same(draft, widget) });
  }
  private change(widget: HomeWidget) {
    this.publish({ widget, dirty: !same(widget, this.saved), error: null });
  }
  setText = (text: string) => this.change({ ...this.state.widget, text });
  changeItem = (id: string, patch: Partial<Pick<TodoItem, 'text' | 'completed'>>) => {
    this.change({ ...this.state.widget, items: this.state.widget.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };
  removeItem = (id: string) => {
    this.change({ ...this.state.widget, items: this.state.widget.items.filter((item) => item.id !== id) });
  };
  async addItem(item: TodoItem): Promise<boolean> {
    if (this.adding) return false;
    this.adding = true;
    this.change({ ...this.state.widget, items: [...this.state.widget.items, item] });
    try { await this.flush(); return true; }
    catch (error) {
      if (this.saved.items.some(({ id }) => id === item.id)) return true;
      this.removeItem(item.id);
      this.publish({ error: this.state.dirty ? error : null });
      throw error;
    } finally { this.adding = false; }
  }
  flush = (): Promise<void> => {
    if (this.running) return this.running;
    if (!this.state.dirty) return Promise.resolve();
    this.publish({ saving: true, error: null });
    this.running = this.drain().finally(() => {
      this.running = undefined;
      this.publish({ saving: false });
    });
    return this.running;
  };
  private async drain() {
    while (this.state.dirty) {
      const sent = this.state.widget;
      this.echoes.add(JSON.stringify(sent));
      try { await this.save(sent); }
      catch (error) { this.publish({ error }); throw error; }
      this.saved = sent;
      this.publish({ dirty: !same(this.state.widget, sent) });
    }
  }
}

export function warnUnsaved(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}
