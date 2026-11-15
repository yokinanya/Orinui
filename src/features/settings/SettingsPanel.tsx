import type { ReactElement } from 'react';
import { useState } from 'react';
import { Palette, LayoutGrid, Search, Database, Info, Bookmark } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AboutCard } from '@/features/settings/AboutCard';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { BookmarkSettingsPanel } from '@/features/bookmarks/BookmarkSettingsPanel';
import { DataManagementPanel } from '@/features/settings/DataManagementPanel';
import { LayoutPanel } from '@/features/settings/LayoutPanel';
import { SearchSettingsPanel } from '@/features/settings/SearchSettingsPanel';
import { SettingsDragGuardProvider, useSettingsDragGuardValue } from '@/features/settings/settings-drag-guard';
import { SettingsDragCancelBridge } from '@/features/settings/SettingsDragCancelBridge';
import { OperationInlineStatus } from '@/app/operations';

interface SettingsPanelProps {
  readonly trigger: ReactElement;
}

const panelClass = 'settings-panel-scroll col-start-2 row-start-1 min-h-0 min-w-0 overflow-y-auto px-3 pt-4 pb-6 sm:px-6';

/**
 * 设置弹层受控开关。
 *
 * 面板内有两个 dnd 区域（壁纸素材库、主页区域顺序）。拖拽激活期间关闭弹层会卸载
 * DndContext，而 dnd-kit 的传感器监听挂在 document 上、只有 end/cancel 才 detach，
 * 残留监听会让之后的无关按键触发旧 onDragEnd 写库。所以拖拽中拒绝任何关闭请求
 * （Escape、关闭按钮、遮罩、焦点移出），让传感器先收到它自己的取消/结束；
 * 未拖拽时完全保留原有打开/关闭语义。
 */
export function SettingsPanel({ trigger }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const dragGuard = useSettingsDragGuardValue();
  const handleOpenChange = (next: boolean, details: { cancel(): void }) => {
    if (!next && dragGuard.isDragging()) {
      details.cancel();
      return;
    }
    setOpen(next);
  };
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger render={<DialogTrigger render={trigger} />} />
        <TooltipContent side="left">设置</TooltipContent>
      </Tooltip>
      <DialogContent className="settings-panel flex h-[min(44rem,calc(100dvh-2rem))] w-[min(76rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden border-border/60 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:max-w-none">
        <SettingsDragGuardProvider guard={dragGuard}>
          <SettingsDragCancelBridge />
          <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border/40 py-5 pr-16 pl-5 sm:pl-7">
                    <DialogTitle className="shrink-0">设置</DialogTitle>
            <OperationInlineStatus />
          </DialogHeader>

          <Tabs defaultValue="appearance" orientation="vertical"
            className="grid min-h-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-0 sm:grid-cols-[11.5rem_minmax(0,1fr)]">
            <div className="settings-panel-nav min-h-0 bg-muted/10 px-1.5 pt-3 sm:px-3">
              <TabsList className="w-full flex-col items-stretch gap-1 bg-transparent p-0">
                <TabsTrigger value="appearance" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><Palette aria-hidden="true" className="hidden sm:block" />外观</TabsTrigger>
                <TabsTrigger value="layout" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><LayoutGrid aria-hidden="true" className="hidden sm:block" />布局</TabsTrigger>
                <TabsTrigger value="bookmarks" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><Bookmark aria-hidden="true" className="hidden sm:block" />收藏夹</TabsTrigger>
                <TabsTrigger value="search" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><Search aria-hidden="true" className="hidden sm:block" />搜索</TabsTrigger>
                <TabsTrigger value="data" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><Database aria-hidden="true" className="hidden sm:block" />数据</TabsTrigger>
                <TabsTrigger value="about" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm"><Info aria-hidden="true" className="hidden sm:block" />关于</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="appearance" className={panelClass}>
              <AppearancePanel />
            </TabsContent>
            <TabsContent value="layout" className={panelClass}>
              <LayoutPanel />
            </TabsContent>
            <TabsContent value="bookmarks" className={panelClass}>
              <BookmarkSettingsPanel />
            </TabsContent>
            <TabsContent value="about" className={panelClass}>
              <AboutCard />
            </TabsContent>
            <TabsContent value="search" className={panelClass}>
              <SearchSettingsPanel />
            </TabsContent>
            <TabsContent value="data" className={panelClass}>
              <DataManagementPanel />
            </TabsContent>
          </Tabs>
        </SettingsDragGuardProvider>
      </DialogContent>
    </Dialog>
  );
}
