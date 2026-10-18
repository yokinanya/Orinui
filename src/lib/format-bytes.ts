const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('字节数格式无效');
  let value = bytes;
  for (const [index, unit] of BYTE_UNITS.entries()) {
    if (value < 1024 || index === BYTE_UNITS.length - 1) {
      return `${value.toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${unit}`;
    }
    value /= 1024;
  }
  throw new Error('字节数格式无效');
}
