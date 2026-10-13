import { fail } from '@/domain/errors';
import type { SyncRegister } from '@/domain/sync/types';

export type RecordValue = Record<string, unknown>;

export function asRecord(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label}格式不正确`);
  return value as RecordValue;
}

export function exactKeys(raw: RecordValue, keys: readonly string[], label: string): void {
  if (Object.keys(raw).length !== keys.length || !keys.every((key) => Object.hasOwn(raw, key))) fail(`${label}字段不正确`);
}

export function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不能为空`);
  if (value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/.test(value)) fail(`${label}不能包含首尾空白或控制字符`);
  return value;
}

export function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(`${label}必须是非负安全整数`);
  return value as number;
}

export function validateRegister<T>(value: unknown, label: string, parse: (value: unknown) => T): SyncRegister<T> {
  const raw = asRecord(value, label);
  exactKeys(raw, ['value', 'clock', 'deviceId'], label);
  return { value: parse(raw.value), clock: integer(raw.clock, `${label}时钟`), deviceId: identifier(raw.deviceId, `${label}设备标识`) };
}

export function parseString(value: unknown, label: string): string {
  return identifier(value, label);
}
