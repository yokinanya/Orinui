import type { ReactElement } from 'react';

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
import { DataManagementPanel } from '@/features/settings/DataManagementPanel';
import { LayoutPanel } from '@/features/settings/LayoutPanel';
import { SearchSettingsPanel } from '@/features/settings/SearchSettingsPanel';

interface SettingsPanelProps {
  readonly trigger: ReactElement;
}

const panelClass = 'settings-panel-scroll col-start-2 row-start-1 min-h-0 min-w-0 overflow-y-auto px-4 pt-3 pb-6 sm:px-7';

export function SettingsPanel({ trigger }: SettingsPanelProps) {
  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger render={<DialogTrigger render={trigger} />} />
        <TooltipContent>设置</TooltipContent>
      </Tooltip>
      <DialogContent className="settings-panel flex h-[min(44rem,calc(100dvh-2rem))] w-[min(56rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden border-border/60 bg-popover/95 p-0 shadow-2xl backdrop-blur-xl sm:max-w-none">
        <DialogHeader className="border-b border-border/40 px-5 pt-5 pb-4 sm:px-7">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="appearance" orientation="vertical"
          className="grid min-h-0 flex-1 grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-0 sm:grid-cols-[11.5rem_minmax(0,1fr)]">
          <div className="settings-panel-nav min-h-0 bg-muted/10 px-1.5 pt-3 sm:px-3">
            <TabsList className="w-full flex-col items-stretch gap-1 bg-transparent p-0">
              <TabsTrigger value="appearance" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm">外观</TabsTrigger>
              <TabsTrigger value="layout" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm">布局</TabsTrigger>
              <TabsTrigger value="search" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm">搜索</TabsTrigger>
              <TabsTrigger value="data" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm">数据</TabsTrigger>
              <TabsTrigger value="about" className="h-9 w-full flex-none justify-start px-1.5 text-xs sm:px-3 sm:text-sm">关于</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="appearance" className={panelClass}>
            <AppearancePanel />
          </TabsContent>
          <TabsContent value="layout" className={panelClass}>
            <LayoutPanel />
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
      </DialogContent>
    </Dialog>
  );
}
