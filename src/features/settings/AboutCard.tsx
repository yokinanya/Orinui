import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getExtensionInfo } from '@/platform/extension';

/**
 * 扩展信息。
 *
 * 只在设置面板打开时挂载，避免首屏读取扩展 API，也让面板保持延迟加载。
 */
export function AboutCard() {
  const info = getExtensionInfo();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{info.name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">版本 {info.version}</CardContent>
    </Card>
  );
}
