import { fail } from '@/domain/errors';

/** 校验辅助：把未知输入确认成对象，失败时给出中文原因。 */
export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label}格式不正确`);
  }
  return value as Record<string, unknown>;
}
