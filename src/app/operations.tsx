import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIcon, CheckIcon, CircleAlertIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { newId } from '@/domain/id';
import type { SyncTransferEvent } from '@/sync/ports';

export interface UndoAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Operation {
  readonly id: string;
  readonly title: string;
  readonly phase: string;
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly error?: string;
  /** 可撤销操作的入口；运行结束后自动清除。 */
  readonly undo?: UndoAction;
  readonly completed?: number;
  readonly total?: number;
  readonly unit?: 'bytes' | 'items';
  readonly objectsCompleted?: number;
  readonly objectsTotal?: number;
}

export interface OperationHandle {
  update(phase: string): void;
  progress(input: { readonly phase: string; readonly completed: number; readonly total: number; readonly unit: Operation['unit'];
    readonly objectsCompleted?: number; readonly objectsTotal?: number }): void;
  succeed(phase: string): void;
  fail(error: unknown): void;
}

export interface OperationValue {
  readonly operations: readonly Operation[];
  begin(title: string, phase: string, key?: string): OperationHandle;
  /** 给正在进行的可撤销操作附加撤销入口。 */
  offerUndo(key: string, label: string, run: () => void): void;
  dismiss(id: string): void;
}

const OperationContext = createContext<OperationValue | null>(null);

/** 出现撤销入口时操作中心自动展开的时长。 */
const UNDO_REVEAL_MS = 5000;

export function reportSyncProgress(task: OperationHandle, event: SyncTransferEvent): void {
  const files = event.totalObjects === undefined
    ? event.completedObjects === undefined ? '' : ` · 已检查 ${event.completedObjects.toLocaleString()} 个对象`
    : ` ${event.completedObjects ?? 0}/${event.totalObjects} 个文件`;
  const object = event.objectId ? ` · ${event.objectId}` : '';
  if (event.totalBytes === undefined) { task.update(`${event.phase}${files}${object}`); return; }
  task.progress({ phase: `${event.phase}${object}`, completed: event.completedBytes ?? 0, total: event.totalBytes,
    unit: 'bytes', ...(event.completedObjects === undefined ? {} : { objectsCompleted: event.completedObjects }),
    ...(event.totalObjects === undefined ? {} : { objectsTotal: event.totalObjects }) });
}

export function OperationProvider({ children }: { readonly children: ReactNode }) {
  const [operations, setOperations] = useState<Operation[]>([]);
  const keyedOperations = useRef(new Map<string, string>());
  const begin = useCallback((title: string, phase: string, key?: string): OperationHandle => {
    const existingId = key ? keyedOperations.current.get(key) : undefined;
    const operation = { id: existingId ?? newId(), title, phase, status: 'running' as const };
    if (key) keyedOperations.current.set(key, operation.id);
    setOperations((current) => current.some(({ id }) => id === operation.id)
      ? current.map((item) => item.id === operation.id ? operation : item) : [...current, operation]);
    const update = (patch: Partial<Operation>) => setOperations((current) => current.map((item) =>
      item.id === operation.id ? { ...item, ...patch } : item));
    return { update: (nextPhase) => update({ phase: nextPhase }),
      progress: ({ phase: nextPhase, completed, total, unit, objectsCompleted, objectsTotal }) => update({ phase: nextPhase,
        completed, total, unit, objectsCompleted, objectsTotal }),
      succeed: (nextPhase) => update({ phase: nextPhase, status: 'succeeded', error: undefined, undo: undefined }),
      fail: (error) => update({ status: 'failed', error: error instanceof Error ? error.message : String(error), undo: undefined }) };
  }, []);
  const offerUndo = useCallback((key: string, label: string, run: () => void) => {
    const id = keyedOperations.current.get(key);
    if (!id) throw new Error(`可撤销操作不存在：${key}`);
    setOperations((current) => current.map((item) => (item.id === id ? { ...item, undo: { label, run } } : item)));
  }, []);
  const dismiss = useCallback((id: string) => {
    for (const [key, value] of keyedOperations.current) if (value === id) keyedOperations.current.delete(key);
    setOperations((current) => current.filter((item) => item.id !== id));
  }, []);
  const value = useMemo(() => ({ operations, begin, offerUndo, dismiss }), [operations, begin, offerUndo, dismiss]);
  return <OperationContext value={value}>{children}</OperationContext>;
}

export function useOperations(): OperationValue {
  const value = use(OperationContext);
  if (!value) throw new Error('操作状态未初始化');
  return value;
}

function operationProgress(operation: Operation): string {
  if (operation.completed === undefined || operation.total === undefined || !operation.unit) return operation.phase;
  const unit = operation.unit === 'bytes' ? 'B' : '项';
  const objects = operation.objectsTotal === undefined ? ''
    : ` · ${operation.objectsCompleted?.toLocaleString() ?? 0} / ${operation.objectsTotal.toLocaleString()} 个文件`;
  return `${operation.phase} · ${operation.completed.toLocaleString()} / ${operation.total.toLocaleString()} ${unit}${objects}`;
}

function operationButtonLabel(operations: readonly Operation[]): string {
  const running = operations.filter(({ status }) => status === 'running').length;
  const undoable = operations.some((operation) => operation.undo !== undefined);
  if (running > 0) return `查看任务，${running} 项进行中${undoable ? '，含可撤销操作' : ''}`;
  return undoable ? '查看任务，有可撤销的删除' : '查看任务';
}

export function OperationCenterButton() {
  const { operations, dismiss } = useOperations();
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const undoable = operations.some((operation) => operation.undo !== undefined);
  // 删除后短暂自动展开一次，让撤销入口可见；用户关闭或手动操作后不再自动展开。
  useEffect(() => {
    if (!undoable) { window.clearTimeout(timer.current); setOpen(false); return; }
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), UNDO_REVEAL_MS);
    return () => window.clearTimeout(timer.current);
  }, [undoable]);
  if (!operations.some((operation) => operation.status !== 'succeeded' || operation.undo)) return null;
  const running = operations.filter(({ status }) => status === 'running').length;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={<Button type="button" variant="ghost" size="icon" aria-label={operationButtonLabel(operations)}
      className="home-readable-control home-readable-focus relative rounded-full"><ActivityIcon />
      {running > 0 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary" />}
      {undoable && <span className="absolute -top-0.5 -left-0.5 size-2 rounded-full bg-destructive" />}</Button>} />
    <PopoverContent side="bottom" align="end" role="region" aria-label="操作状态" initialFocus={false} finalFocus={false}
      className="max-h-[min(38rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto">
      <h2 className="text-sm font-semibold">操作状态</h2>
      <ul className="flex flex-col gap-2">
        {operations.map((operation) => <li key={operation.id} className="flex items-start gap-3 rounded-xl border p-3">
          {operation.status === 'running' ? <ActivityIcon className="mt-0.5 size-4 animate-pulse" />
            : operation.status === 'failed' ? <CircleAlertIcon className="mt-0.5 size-4 text-destructive" />
              : <CheckIcon className="mt-0.5 size-4 text-primary" />}
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{operation.title}</span>
            <span className="block break-words text-xs text-muted-foreground">{operation.error ?? operationProgress(operation)}</span></span>
          {operation.undo && <Button type="button" variant="outline" size="sm" className="shrink-0"
            onClick={operation.undo.run}>{operation.undo.label}</Button>}
          {operation.status !== 'running' && <Button type="button" variant="ghost" size="icon-sm"
            aria-label={`关闭${operation.title}状态`} onClick={() => dismiss(operation.id)}><XIcon /></Button>}
        </li>)}
      </ul>
    </PopoverContent>
  </Popover>;
}

const INLINE_STATUS_DEBOUNCE_MS = 300;

function useInlineStatus(operation: Operation | undefined): string | null {
  const failed = operation?.status === 'failed';
  const message = operation ? `${operation.title} · ${failed ? '操作失败，请查看详情' : operationProgress(operation)}` : null;
  const [settledMessage, setSettledMessage] = useState<string | null>(null);
  useEffect(() => {
    if (failed || message === null) { setSettledMessage(message); return; }
    const timer = window.setTimeout(() => setSettledMessage(message), INLINE_STATUS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [failed, message]);
  if (message === null || failed) return message;
  return settledMessage;
}

export function OperationInlineStatus() {
  const { operations } = useOperations();
  const message = useInlineStatus(operations.at(-1));
  if (message === null) return null;
  return <p role="status" aria-live="polite" aria-label="最近的操作状态" className="min-w-0 break-words text-right text-xs text-muted-foreground">
    {message}
  </p>;
}
