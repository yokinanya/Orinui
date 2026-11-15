import { useEffect } from 'react';

import { useSettingsDragGuard } from '@/features/settings/settings-drag-guard';

/**
 * 拖拽会话激活期间把真实 Escape 转送给 document 上的 dnd-kit 传感器。
 *
 * 为什么必须在 document 捕获阶段：Base UI 的 Popup 在 React onKeyDown 里处理 Escape
 * 并调用 stopPropagation；dnd-kit 的传感器监听（KeyboardSensor 的 handleKeyDown 与
 * PointerSensor 的 handleKeydown）都在 document 冒泡阶段。焦点在弹层内任意元素时，
 * Escape 会先被 Popup 的 React 处理器拦下，传感器永远收不到 cancel：键盘会话不 detach，
 * 指针会话随后 mouseup 就把顺序提交了。捕获阶段早于任何 React 处理器，所以在这里转发
 * 一份 Escape 给 document，让传感器走自己的 handleCancel/detach，然后吞掉原事件。
 *
 * 转发的合成事件 isTrusted 为 false；本监听只处理 isTrusted，因此不会递归或双触发。
 * 未拖拽时根本不注册监听，Escape 完全保留原有“关闭弹层”语义。转发的 Escape 仍会到达
 * Base UI 的 useDismiss，此时受控 onOpenChange 因仍在拖拽而 details.cancel()，弹层保持打开。
 */
export function SettingsDragCancelBridge() {
  const guard = useSettingsDragGuard();
  useEffect(() => {
    if (!guard) return undefined;
    const ownerDocument = document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.key !== 'Escape' || event.defaultPrevented) return;
      if (!guard.isDragging()) return;
      const forwarded = new KeyboardEvent('keydown', {
        key: event.key, code: event.code, location: event.location, repeat: event.repeat,
        ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
        bubbles: true, cancelable: true,
      });
      ownerDocument.dispatchEvent(forwarded);
      // 传感器已取消并 detach；吞掉真实 Escape，弹层保持打开。
      event.preventDefault();
      event.stopPropagation();
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    return () => ownerDocument.removeEventListener('keydown', onKeyDown, true);
  }, [guard]);
  return null;
}
