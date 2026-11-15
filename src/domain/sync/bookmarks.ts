import { fail } from '@/domain/errors';
import type { BookmarkHiddenRule } from '@/domain/bookmark-preferences';
import type { SyncBookmarkRules, SyncRegister } from '@/domain/sync/types';

function registerOrder(left: SyncRegister<unknown>, right: SyncRegister<unknown>): number {
  if (left.clock !== right.clock) return left.clock - right.clock;
  if (left.deviceId === right.deviceId) return 0;
  return left.deviceId < right.deviceId ? -1 : 1;
}

/**
 * 隐藏规则逐条 LWW。
 *
 * 每条规则的寄存器整体胜出，不同设备修改不同规则不会互相覆盖。`null` 是**删除值**：
 * 谁胜出取决于普通寄存器顺序（clock，其次 deviceId），与其他寄存器完全同构，因此
 * 更高逻辑版本的规则值可以覆盖更旧的 `null`，不做跨逻辑版本的 delete-wins 特殊处理。
 * 本机写入端另有约束：已删除的 `ruleId` 不复用（见 `buildBookmarkRules`），那是本地
 * 生成规则的限制，不能推论成跨设备比较也永久删除。
 *
 * 同一逻辑版本（clock + deviceId）却携带不同内容时整笔拒绝，不按遍历顺序静默选一个。
 * 结果按键排序，保证任何设备得出同一序列。
 */
export function mergeBookmarkRuleRegisters(registers: readonly SyncBookmarkRules[]): SyncBookmarkRules {
  const merged = new Map<string, SyncRegister<BookmarkHiddenRule | null>>();
  for (const register of registers) {
    for (const [ruleId, value] of Object.entries(register)) {
      const current = merged.get(ruleId);
      if (!current) { merged.set(ruleId, value); continue; }
      const order = registerOrder(value, current);
      if (order === 0 && JSON.stringify(value.value) !== JSON.stringify(current.value)) {
        fail('同一隐藏规则逻辑版本包含不同内容');
      }
      merged.set(ruleId, order >= 0 ? value : current);
    }
  }
  return Object.fromEntries([...merged].sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1)));
}
