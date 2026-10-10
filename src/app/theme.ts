import { useEffect, useState } from 'react';

import { applyAppearance, type ApplyAppearanceInput } from '@/app/apply-appearance';

/** 订阅系统深浅偏好；外观设置里的“跟随系统”使用它。 */
export function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setPrefersDark(query.matches);

    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return prefersDark;
}

/** 外观变化时把主题、背景与动态配色同步到根元素。 */
export function useApplyAppearance(input: ApplyAppearanceInput): void {
  const { appearance, systemPrefersDark, photoSeed = null, photoUrl = null } = input;

  useEffect(() => {
    applyAppearance({ appearance, systemPrefersDark, photoSeed, photoUrl });
  }, [appearance, systemPrefersDark, photoSeed, photoUrl]);
}
