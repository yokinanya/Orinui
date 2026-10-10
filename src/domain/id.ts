/** 稳定唯一标识：创建后不再改变，用于排序、引用与未来的同步。 */
export function newId(): string {
  return crypto.randomUUID();
}
