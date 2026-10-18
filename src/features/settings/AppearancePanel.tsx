import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, Images } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BackgroundPanel } from '@/features/settings/BackgroundPanel';
import { DynamicColorPanel } from '@/features/settings/DynamicColorPanel';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { ThemePanel } from '@/features/settings/ThemePanel';
import { WallpaperLibrary } from '@/features/settings/WallpaperLibrary';

export function AppearancePanel() {
  const [page, setPage] = useState<'appearance' | 'background' | 'create'>('appearance');
  const backgroundTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const returnFromCreate = useRef(false);
  useEffect(() => {
    if (page === 'appearance' && restoreFocus.current) {
      backgroundTrigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [page]);
  const returnToParent = () => {
    restoreFocus.current = true;
    returnFromCreate.current = page === 'create';
    setPage(page === 'create' ? 'background' : 'appearance');
  };
  if (page === 'create') return (
    <div key="create" className="flex flex-col gap-5">
      <Button autoFocus variant="ghost" className="self-start" onClick={returnToParent}>
        <ArrowLeft data-icon="inline-start" />返回壁纸库
      </Button>
      <SettingsSection title="新建壁纸" description="选择背景类型或上传壁纸。">
        <BackgroundPanel fresh />
      </SettingsSection>
    </div>
  );
  if (page === 'background') return (
    <div key="background" className="wallpaper-page flex h-full min-h-0 flex-col gap-2">
      <Button autoFocus={!returnFromCreate.current} variant="ghost" className="self-start" onClick={returnToParent}>
        <ArrowLeft data-icon="inline-start" />返回外观
      </Button>
      <WallpaperLibrary focusCreate={returnFromCreate.current} onCreate={() => setPage('create')} />
    </div>
  );
  return <AppearanceHome trigger={backgroundTrigger} onOpen={() => setPage('background')} />;
}

function AppearanceHome({ trigger, onOpen }: {
  readonly trigger: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
}) {
  return (
    <div className="settings-columns settings-appearance-columns grid items-start gap-4">
      <SettingsSection title="主题模式"><ThemePanel /></SettingsSection>
      <SettingsSection title="背景">
        <Button ref={trigger} variant="outline" className="w-full justify-between" onClick={onOpen}>
          <span className="flex items-center gap-2"><Images data-icon="inline-start" />壁纸与背景</span>
          <ArrowRight data-icon="inline-end" />
        </Button>
      </SettingsSection>
      <SettingsSection title="界面配色"><DynamicColorPanel /></SettingsSection>
    </div>
  );
}
