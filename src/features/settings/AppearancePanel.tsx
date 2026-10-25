import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BackgroundPanel } from '@/features/settings/BackgroundPanel';
import { DynamicColorPanel } from '@/features/settings/DynamicColorPanel';
import { SettingsSection } from '@/features/settings/SettingsSection';
import { ThemePanel } from '@/features/settings/ThemePanel';
import { WallpaperLibrary } from '@/features/settings/WallpaperLibrary';
import { WallpaperUploadPanel } from '@/features/settings/WallpaperUploadPanel';

export function AppearancePanel() {
  const [page, setPage] = useState<'appearance' | 'background' | 'create'>('appearance');
  const backgroundTrigger = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const returnFromCreate = useRef(false);
  useEffect(() => {
    if (page === 'appearance' && restoreFocus.current) {
      backgroundTrigger.current?.querySelector('[data-open-wallpaper-library]')?.closest('button')?.focus();
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
      <SettingsSection title="添加壁纸" description="上传照片、动态素材，或主动下载图片。">
        <WallpaperUploadPanel />
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
  return <AppearanceHome trigger={backgroundTrigger} returning={restoreFocus.current} onOpen={() => setPage('background')} />;
}

function AppearanceHome({ trigger, onOpen, returning }: {
  readonly trigger: RefObject<HTMLDivElement | null>;
  readonly onOpen: () => void;
  readonly returning: boolean;
}) {
  return (
    <div className="settings-columns grid items-start gap-4">
      <div className="flex min-w-0 flex-col gap-4">
        <SettingsSection title="主题模式"><ThemePanel /></SettingsSection>
        <SettingsSection title="背景">
          <div ref={trigger} tabIndex={-1} className="focus:outline-none"><BackgroundPanel onOpenLibrary={onOpen} initialWallpaper={returning} /></div>
        </SettingsSection>
      </div>
      <SettingsSection title="界面配色"><DynamicColorPanel /></SettingsSection>
    </div>
  );
}
