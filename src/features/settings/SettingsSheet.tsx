import type { ReactElement } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AboutCard } from '@/features/settings/AboutCard';
import { AppearancePanel } from '@/features/settings/AppearancePanel';
import { LayoutPanel } from '@/features/settings/LayoutPanel';

interface SettingsSheetProps {
  trigger: ReactElement;
}

/**
 * 各分区共用的面板类。
 *
 * 内边距放在滚动容器自己身上（而不是外层容器），容器的内容盒因此比外层窄：
 * Switch 用 `after:-inset-x-3` 扩大点击热区，这段装饰性热区会伸进面板自身的
 * 内边距里，不再溢出内容盒，也就不会出现横向滚动。
 */
const panelClass = 'min-h-0 overflow-y-auto px-6 pt-2';

/**
 * 设置抽屉。
 *
 * 网站与分组的增删改排序都在主页完成（右键菜单 + 编辑模式），
 * 这里只保留外观、布局与关于；数据导入导出在后续阶段加入。
 */
export function SettingsSheet({ trigger }: SettingsSheetProps) {
  return (
    <Sheet>
      <Tooltip>
        <TooltipTrigger render={<SheetTrigger render={trigger} />} />
        <TooltipContent>设置</TooltipContent>
      </Tooltip>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>设置</SheetTitle>
          <SheetDescription>调整外观与布局。网站和分组请在主页上直接编辑。</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="appearance" className="min-h-0 flex-1 pb-6">
          <div className="px-6">
            <TabsList className="w-full">
              <TabsTrigger value="appearance">外观</TabsTrigger>
              <TabsTrigger value="layout">布局</TabsTrigger>
              <TabsTrigger value="about">关于</TabsTrigger>
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
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
