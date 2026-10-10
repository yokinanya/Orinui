import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsSheet } from '@/features/settings/SettingsSheet';

/**
 * 设置入口。
 *
 * 视觉规格：固定在右下角的低对比图标，悬停或键盘聚焦时出现轻薄圆形底；
 * 它不属于可隐藏或可排序区域，保证用户始终能恢复页面配置。
 * 这里只提供按钮本身，触发器与提示的嵌套由设置抽屉内部控制。
 */
export function SettingsTrigger() {
  return (
    <div className="fixed right-4 bottom-4 z-40 md:right-6 md:bottom-6">
      <SettingsSheet
        trigger={
          <Button variant="ghost" size="icon" aria-label="设置" className="rounded-full">
            <Settings />
          </Button>
        }
      />
    </div>
  );
}
