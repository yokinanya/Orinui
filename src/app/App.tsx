import { BackgroundLayer } from '@/app/BackgroundLayer';
import { useData } from '@/app/data-context';
import { DataProvider } from '@/app/DataProvider';
import { useApplyAppearance, useSystemPrefersDark } from '@/app/theme';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { visibleSlots, type SlotId } from '@/domain/layout';
import { Clock } from '@/features/clock/Clock';
import { SearchField } from '@/features/search/SearchField';
import { SettingsTrigger } from '@/features/settings/SettingsTrigger';
import { ShortcutsRegion } from '@/features/shortcuts/ShortcutsRegion';

function renderSlot(slot: SlotId) {
  switch (slot) {
    case 'clock':
      return <Clock key={slot} />;
    case 'search':
      return (
        <div key={slot} className="w-full max-w-xl">
          <SearchField />
        </div>
      );
    case 'shortcuts':
      return <ShortcutsRegion key={slot} />;
  }
}

function LoadingState() {
  return (
    <div className="flex w-full flex-col items-center gap-6" aria-busy="true">
      <Skeleton className="h-16 w-48 rounded-2xl" />
      <Skeleton className="h-12 w-full max-w-xl rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  );
}

/**
 * 主页组合。
 *
 * 数据契约 §4：按固定命名插槽的持久化顺序渲染，隐藏的区域不渲染。
 * 初始化失败时显示明确原因，而不是让页面停留在空白状态。
 */
function HomePage() {
  const { status, error, settings } = useData();
  const systemPrefersDark = useSystemPrefersDark();

  useApplyAppearance({ appearance: settings.appearance, systemPrefersDark });

  if (status === 'loading') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">
          <LoadingState />
        </div>
      </main>
    );
  }

  if (status === 'error') {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          <Alert variant="destructive">
            <AlertTitle>本地数据无法读取</AlertTitle>
            <AlertDescription>{error ?? '未知错误'}</AlertDescription>
          </Alert>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6 py-16">
      <div className="flex w-full max-w-3xl flex-col items-center gap-10">
        {visibleSlots(settings.layout).map(renderSlot)}
      </div>
    </main>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <Toaster>
        <DataProvider>
          <BackgroundLayer />
          <HomePage />
          <SettingsTrigger />
        </DataProvider>
      </Toaster>
    </TooltipProvider>
  );
}
