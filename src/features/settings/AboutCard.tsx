import { useEffect, useState } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getExtensionInfo } from '@/platform/extension';

/**
 * 扩展信息。
 *
 * 只在设置面板打开时挂载，避免首屏读取扩展 API，也让面板保持延迟加载。
 */
export function AboutCard() {
  const info = useExtensionInfo();

  return (
    <Card size="sm" className="rounded-xl">
      <CardHeader>
        <CardTitle>{info.name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">版本 {info.version}</CardContent>
    </Card>
  );
}

/** 读取扩展信息；读取失败时显示真实原因，避免整个设置面板崩溃。 */
function useExtensionInfo(): { readonly name: string; readonly version: string } {
  const [state, setState] = useState<{ readonly name: string; readonly version: string } | { readonly error: string } | null>(null);
  useEffect(() => {
    try {
      setState(getExtensionInfo());
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : String(error) });
    }
  }, []);
  if (!state) return { name: 'Orinui', version: '读取中…' };
  return 'error' in state ? { name: 'Orinui', version: state.error } : state;
}
