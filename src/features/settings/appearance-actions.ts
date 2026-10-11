import { useData } from '@/app/data-context';
import { notifyError } from '@/lib/notify';

export function useAppearanceActions() {
  const { settings, updateAppearance, isDark } = useData();
  const update = (patch: Parameters<typeof updateAppearance>[0]) => {
    void updateAppearance(patch).catch(notifyError);
  };
  return { appearance: settings.appearance, isDark, update };
}
