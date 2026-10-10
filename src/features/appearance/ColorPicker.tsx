import { PipetteIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  hexToHsv,
  hsvToHex,
  parseHex,
  rgbToHsv,
  type Hsv,
} from '@/features/appearance/color-math';
import { HueBar } from '@/features/appearance/HueBar';
import { SaturationValueArea } from '@/features/appearance/SaturationValueArea';
import { useThrottledEmit } from '@/hooks/use-throttled-emit';
import { notifyError } from '@/lib/notify';
import { canPickColorFromScreen, pickColorFromScreen } from '@/platform/eyedropper';

interface ColorPickerProps {
  id: string;
  value: string;
  onChange: (color: string) => void;
  /** 供辅助技术读取的名称，例如“起始颜色” */
  label: string;
}

/**
 * 取色控件。
 *
 * 自建而不是用原生 `input[type=color]`：原生取色弹窗由浏览器绘制，无法跟随应用的圆角、
 * 间距与语义色，放在设置面板里就是一块异色区域。屏幕吸管用 EyeDropper API 保留，
 * 面板内另有色相条与十六进制输入，键盘可达任意颜色。
 *
 * 拖动期间颜色变化很密，这里用节流合并写入，避免每一次 pointermove 都落一次数据库。
 */
export function ColorPicker({ id, value, onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const { emit, flush } = useThrottledEmit(onChange);
  const supportsEyedropper = useMemo(canPickColorFromScreen, []);

  // 收起时跟随外部值；展开时不跟随，否则十六进制往返会在 s=0 或 v=0 时丢掉色相
  useEffect(() => {
    if (!open) setHsv(hexToHsv(value));
  }, [open, value]);

  useEffect(() => {
    if (!open) setHexDraft(null);
  }, [open]);

  const apply = (next: Hsv) => {
    setHsv(next);
    emit(hsvToHex(next));
  };

  const hexText = hexDraft ?? hsvToHex(hsv);
  const hexInvalid = hexDraft !== null && parseHex(hexDraft) === null;

  const pickFromScreen = () => {
    void (async () => {
      try {
        const picked = await pickColorFromScreen();
        if (picked === null) return;

        apply(hexToHsv(picked));
        flush();
      } catch (error) {
        notifyError(error);
      }
    })();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            aria-label={`${label}，当前 ${value}`}
            className="size-8 shrink-0 cursor-pointer rounded-full border border-border outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/40"
            style={{ backgroundColor: value }}
          />
        }
      />
      <PopoverContent align="end" className="w-64 gap-3 p-3">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <SaturationValueArea hsv={hsv} onPreview={apply} onCommit={flush} />
        <HueBar hue={hsv.h} onPreview={(nextHue) => apply({ ...hsv, h: nextHue })} onCommit={flush} />
        <div className="flex items-center gap-2">
          <Input
            value={hexText}
            autoComplete="off"
            spellCheck={false}
            aria-label="十六进制颜色"
            aria-invalid={hexInvalid || undefined}
            className="h-8 font-mono"
            onChange={(event) => {
              const text = event.target.value;
              setHexDraft(text);

              const rgb = parseHex(text);
              if (rgb) apply(rgbToHsv(rgb));
            }}
            onBlur={() => setHexDraft(null)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              flush();
              setHexDraft(null);
            }}
          />
          {supportsEyedropper && (
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label="用吸管从屏幕取色"
              onClick={pickFromScreen}
            >
              <PipetteIcon />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
