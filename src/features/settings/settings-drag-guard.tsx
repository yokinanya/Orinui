import { createContext, use, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * 设置面板内的拖拽守卫。
 *
 * 设置弹层里有两个 dnd 区域：壁纸素材库（KeyboardSensor + PointerSensor）和主页区域
 * 顺序（PointerSensor）。dnd-kit 的传感器在激活时把 keydown/pointerup 等监听挂到
 * ownerDocument，只有 handleEnd/handleCancel 才会 detach。若弹层在拖拽会话结束前被
 * 卸载，这些监听不会随组件消失，之后无关的 Space/Enter/pointerup 仍会触发旧的
 * onDragEnd 并写库。因此拖拽激活期间必须拒绝关闭弹层，让传感器自己收到取消。
 */
export interface SettingsDragGuard {
  /** 是否有设置面板内的拖拽会话处于激活状态；供事件处理同步读取。 */
  isDragging(): boolean;
  /** 拖拽开始/结束/取消时上报；会话结束时必须复位。 */
  setDragging(active: boolean): void;
}

export interface SettingsDragGuardValue extends SettingsDragGuard {
  /** 渲染期快照，供只在拖拽期间生效的订阅使用。 */
  readonly dragging: boolean;
}

const SettingsDragGuardContext = createContext<SettingsDragGuard | null>(null);

export function useSettingsDragGuardValue(): SettingsDragGuardValue {
  const draggingRef = useRef(false);
  const [, setTick] = useState(0);
  return useMemo<SettingsDragGuardValue>(() => ({
    get dragging() { return draggingRef.current; },
    isDragging: () => draggingRef.current,
    setDragging: (active: boolean) => {
      if (draggingRef.current === active) return;
      draggingRef.current = active;
      setTick((tick) => tick + 1);
    },
  }), []);
}

export function SettingsDragGuardProvider({ guard, children }: {
  readonly guard: SettingsDragGuard;
  readonly children: ReactNode;
}) {
  return <SettingsDragGuardContext value={guard}>{children}</SettingsDragGuardContext>;
}

/** 不在设置弹层内时返回 null；调用方据此退化为不拦截关闭。 */
export function useSettingsDragGuard(): SettingsDragGuard | null {
  return use(SettingsDragGuardContext);
}
