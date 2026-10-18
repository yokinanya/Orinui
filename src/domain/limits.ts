/**
 * 数据契约 §6.2 与 §2.2 的量值上限。
 * 用户新增与导入使用同一组上限，避免两条路径出现不同规则。
 */
export const LIMITS = {
  folders: 50,
  shortcuts: 1000,
  customEngines: 20,
  titleGraphemes: 80,
  nameGraphemes: 40,
  urlChars: 2048,
  engineNameGraphemes: 40,
} as const;
