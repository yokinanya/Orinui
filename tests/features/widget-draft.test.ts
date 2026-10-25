import { describe, expect, it, vi } from 'vitest';
import type { HomeWidget, TodoItem } from '@/domain/home';
import { WidgetDraft, WIDGET_SAVE_DEBOUNCE_MS, warnUnsaved } from '@/features/layout/widget-draft';
import { bindUnsavedWarning, startWidgetAutosave } from '@/features/layout/widget-autosave';

const note: HomeWidget = { id: 'note', kind: 'note', text: 'original', items: [] };
const item: TodoItem = { id: 'one', text: 'original', completed: false, order: 0 };
const todo: HomeWidget = { id: 'todo', kind: 'todo', text: '', items: [item] };
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('小组件真实保存与草稿', () => {
  it('串行写入最新草稿，重复失焦共用同一保存，不接受延迟旧 props', async () => {
    const first = deferred();
    const second = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const draft = new WidgetDraft(note, save);
    draft.setText('first');
    const saving = draft.flush();
    expect(draft.flush()).toBe(saving);
    draft.setText('latest');
    draft.receive({ ...note, text: 'first' });
    expect(draft.getSnapshot().widget.text).toBe('latest');
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1]?.[0].text).toBe('latest');
    expect(draft.getSnapshot().saving).toBe(true);
    second.resolve();
    await saving;
    draft.receive({ ...note });
    expect(draft.getSnapshot()).toMatchObject({ dirty: false, saving: false, widget: { text: 'latest' } });
  });

  it('失败明确拒绝、保留最新文本并可重试，不报告成功', async () => {
    const failure = new Error('IndexedDB unavailable');
    const save = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const draft = new WidgetDraft(note, save);
    draft.setText('unsaved');
    await expect(draft.flush()).rejects.toBe(failure);
    expect(draft.getSnapshot()).toMatchObject({ dirty: true, saving: false, error: failure, widget: { text: 'unsaved' } });
    await draft.flush();
    expect(draft.getSnapshot()).toMatchObject({ dirty: false, error: null });
    expect(save.mock.calls[1]?.[0].text).toBe('unsaved');
  });

  it('完成与删除只更新目标字段，后续保存不会带回旧文本或已删除条目', async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const draft = new WidgetDraft({ ...todo, items: [item, { ...item, id: 'two' }] }, save);
    draft.changeItem(item.id, { text: 'latest text' });
    const saving = draft.flush();
    draft.changeItem(item.id, { completed: true });
    draft.removeItem('two');
    first.resolve();
    await saving;
    expect(save.mock.calls[1]?.[0].items).toEqual([{ ...item, text: 'latest text', completed: true }]);
  });

  it('合并真正外部字段而不覆盖本地未保存文本', () => {
    const draft = new WidgetDraft(todo, vi.fn());
    draft.changeItem(item.id, { text: 'local' });
    draft.receive({ ...todo, items: [{ ...item, completed: true }, { ...item, id: 'remote' }] });
    expect(draft.getSnapshot().widget.items).toEqual([{ ...item, text: 'local', completed: true }, { ...item, id: 'remote' }]);
    expect(draft.getSnapshot().dirty).toBe(true);
  });

  it('新增 await 真正提交、防重复；失败移除未提交条目并允许原内容重试', async () => {
    const gate = deferred();
    const save = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const draft = new WidgetDraft(todo, save);
    const added = { ...item, id: 'added', text: 'draft', order: 1 };
    const add = draft.addItem(added);
    let finished = false;
    void add.then(() => { finished = true; }, () => { finished = true; });
    expect(await draft.addItem({ ...added, id: 'duplicate' })).toBe(false);
    expect(finished).toBe(false);
    const failure = new Error('write failed');
    gate.reject(failure);
    await expect(add).rejects.toBe(failure);
    expect(draft.getSnapshot().widget.items).toEqual([item]);
    expect(await draft.addItem(added)).toBe(true);
    expect(save.mock.calls[1]?.[0].items).toEqual([item, added]);
  });

  it('新增保存期间继续编辑仍串行持久化，不阻塞卡片', async () => {
    const gate = deferred();
    const save = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const draft = new WidgetDraft(todo, save);
    const add = draft.addItem({ ...item, id: 'added', order: 1 });
    draft.changeItem(item.id, { text: 'edited while adding', completed: true });
    gate.resolve();
    expect(await add).toBe(true);
    expect(save.mock.calls[1]?.[0].items[0]).toMatchObject({ text: 'edited while adding', completed: true });
  });

  it('停止输入后 debounce 保存、失焦立即保存，卸载取消定时器', async () => {
    vi.useFakeTimers();
    try {
      const save = vi.fn().mockResolvedValue(undefined);
      const draft = new WidgetDraft(note, save);
      const stop = startWidgetAutosave(draft);
      draft.setText('first');
      await vi.advanceTimersByTimeAsync(WIDGET_SAVE_DEBOUNCE_MS - 1);
      expect(save).not.toHaveBeenCalled();
      draft.setText('latest');
      await vi.advanceTimersByTimeAsync(WIDGET_SAVE_DEBOUNCE_MS - 1);
      expect(save).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledWith({ ...note, text: 'latest' });
      draft.setText('blur');
      await draft.flush();
      expect(save).toHaveBeenCalledTimes(2);
      draft.setText('unmounted');
      stop();
      await vi.advanceTimersByTimeAsync(WIDGET_SAVE_DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });

  it('自动保存失败不无限重试，保留可重试错误', async () => {
    vi.useFakeTimers();
    try {
      const failure = new Error('failed');
      const save = vi.fn().mockRejectedValue(failure);
      const draft = new WidgetDraft(note, save);
      const stop = startWidgetAutosave(draft);
      draft.setText('unsaved');
      await vi.advanceTimersByTimeAsync(WIDGET_SAVE_DEBOUNCE_MS);
      await vi.advanceTimersByTimeAsync(WIDGET_SAVE_DEBOUNCE_MS);
      expect(save).toHaveBeenCalledTimes(1);
      expect(draft.getSnapshot()).toMatchObject({ dirty: true, error: failure });
      stop();
    } finally { vi.useRealTimers(); }
  });

  it('beforeunload 监听可正确清理', () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const cleanup = bindUnsavedWarning(target);
    expect(target.addEventListener).toHaveBeenCalledWith('beforeunload', warnUnsaved);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledWith('beforeunload', warnUnsaved);
  });

  it('卸载提醒阻止静默离开', () => {
    const event = { preventDefault: vi.fn(), returnValue: undefined };
    warnUnsaved(event as unknown as BeforeUnloadEvent);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.returnValue).toBe('');
  });
});
