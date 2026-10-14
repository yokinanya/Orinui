export function writeClipboardText(value: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('当前环境无法访问剪贴板');
  return navigator.clipboard.writeText(value);
}
