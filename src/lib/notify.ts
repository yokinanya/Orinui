import { toast } from '@/components/ui/toast';
import type { OperationValue } from '@/app/operations';

/** 把失败原因以提示条呈现；消息来自领域层，直接展示给用户。 */
export function notifyError(error: unknown): void {
  toast.add({
    title: '操作未完成',
    description: error instanceof Error ? error.message : String(error),
    type: 'error',
  });
}

export function notifySuccess(message: string): void {
  toast.add({ title: message, type: 'success' });
}

const UNDO_TIMEOUT_SECONDS = 5;
const UNDO_OPERATION_KEY = 'shortcut-delete-undo';

/**
 * 删除后的撤销提示。
 *
 * 撤销入口放进操作中心：网站名称再长也完整显示，窄屏下提示条不会压住主页操作入口。
 * 5 秒后自动收起；期间执行其他网站删除会替换上一条待撤销记录。
 */
export function notifyRemoved(operations: OperationValue, title: string, undo: () => void): void {
  let remaining = UNDO_TIMEOUT_SECONDS;
  const phase = () => (remaining > 0 ? `5 秒内可在操作中心撤销 · 还剩 ${remaining} 秒` : '撤销时间已过');
  const task = operations.begin(`已删除「${title}」`, phase(), UNDO_OPERATION_KEY);
  const timer = window.setInterval(() => {
    remaining -= 1;
    if (remaining > 0) return;
    window.clearInterval(timer);
    task.succeed('已删除，撤销时间已过');
    operations.dismiss(UNDO_OPERATION_KEY);
  }, 1000);
  operations.offerUndo(UNDO_OPERATION_KEY, '撤销', () => {
    window.clearInterval(timer);
    task.update('正在恢复…');
    try {
      undo();
      task.succeed('已恢复被删除的网站');
    } catch (error) {
      task.fail(error);
      throw error;
    } finally {
      operations.dismiss(UNDO_OPERATION_KEY);
    }
  });
}
