function keyFor(assetId: string): string {
  return `motionPaused:${assetId}`;
}

export async function readMotionPaused(assetId: string): Promise<boolean> {
  const value = window.localStorage.getItem(keyFor(assetId));
  if (value === null) return false;
  if (value !== 'true') throw new Error('动态壁纸暂停偏好数据损坏');
  return true;
}

export async function writeMotionPaused(assetId: string, paused: boolean): Promise<void> {
  const key = keyFor(assetId);
  if (paused) window.localStorage.setItem(key, 'true');
  else window.localStorage.removeItem(key);
}
