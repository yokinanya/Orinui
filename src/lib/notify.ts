import { toast } from '@/components/ui/toast';

/** 把失败原因以提示条呈现；消息来自领域层，直接展示给用户。 */
export function notifyError(error: unknown): void {
  toast.add({
    title: '操作未完成',
    description: error instanceof Error ? error.message : String(error),
    type: 'error',
  });
}

/** 删除单个网站后的撤销提示：默认 5 秒后自动消失。 */
export function notifyRemoved(title: string, undo: () => void): void {
  toast.add({
    title: `已删除「${title}」`,
    description: '5 秒内可以撤销。',
    type: 'info',
    timeout: 5000,
    actionProps: {
      children: '撤销',
      onClick: undo,
    },
  });
}
