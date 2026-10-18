import { PipetteIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';

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
  disabled?: boolean;
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
export function ColorPicker({ id, value, onChange, label, disabled }: ColorPickerProps) {
  const picker = useColorPickerState(value, onChange);

  return (
    <ColorPickerPanel
      id={id}
      label={label}
      value={value}
      disabled={disabled}
      {...picker}
    />
  );
}

interface ColorPickerState {
  open: boolean;
  setOpen: (open: boolean) => void;
  hsv: Hsv;
  hexText: string;
  hexInvalid: boolean;
  supportsEyedropper: boolean;
  apply: (next: Hsv) => void;
  flush: () => void;
  changeHex: (event: ChangeEvent<HTMLInputElement>) => void;
  blurHex: () => void;
  keyDownHex: (event: KeyboardEvent<HTMLInputElement>) => void;
  pickFromScreen: () => void;
}

function useColorPickerState(value: string, onChange: (color: string) => void): ColorPickerState {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState<string | null>(null);

  const { emit, flush } = useThrottledEmit(onChange);
  const supportsEyedropper = useMemo(canPickColorFromScreen, []);
  useColorPickerEffects({ open, value, setHsv, setHexDraft });

  const apply = (next: Hsv) => {
    setHsv(next);
    emit(hsvToHex(next));
  };

  const hexText = hexDraft ?? hsvToHex(hsv);
  const hexInvalid = hexDraft !== null && parseHex(hexDraft) === null;

  const changeHex = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    setHexDraft(text);
    const rgb = parseHex(text);
    if (rgb) apply(rgbToHsv(rgb));
  };

  const keyDownHex = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    flush();
    setHexDraft(null);
  };

  const pickFromScreen = () => {
    void pickColorFromScreen().then((picked) => {
      if (picked === null) return;
      apply(hexToHsv(picked));
      flush();
    }).catch(notifyError);
  };

  return {
    open,
    setOpen,
    hsv,
    hexText,
    hexInvalid,
    supportsEyedropper,
    apply,
    flush,
    changeHex,
    blurHex: () => setHexDraft(null),
    keyDownHex,
    pickFromScreen,
  };
}

function useColorPickerEffects({
  open,
  value,
  setHsv,
  setHexDraft,
}: {
  open: boolean;
  value: string;
  setHsv: (value: Hsv) => void;
  setHexDraft: (value: string | null) => void;
}) {
  // 收起时跟随外部值；展开时不跟随，否则往返输入会在灰色或黑色时丢掉色相。
  useEffect(() => {
    if (!open) setHsv(hexToHsv(value));
  }, [open, value, setHsv]);
  useEffect(() => {
    if (!open) setHexDraft(null);
  }, [open, setHexDraft]);
}

type ColorPickerPanelProps = Omit<ColorPickerProps, 'onChange'> & ColorPickerState;

type ColorPickerEditorProps = Pick<
  ColorPickerState,
  'hsv' | 'hexText' | 'hexInvalid' | 'supportsEyedropper' | 'apply' | 'flush' |
  'changeHex' | 'blurHex' | 'keyDownHex' | 'pickFromScreen'
>;

function ColorPickerEditor({
  hsv,
  hexText,
  hexInvalid,
  supportsEyedropper,
  apply,
  flush,
  changeHex,
  blurHex,
  keyDownHex,
  pickFromScreen,
}: ColorPickerEditorProps) {
  return (
    <>
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
          onChange={changeHex}
          onBlur={blurHex}
          onKeyDown={keyDownHex}
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
    </>
  );
}

function ColorPickerPanel({
  id,
  label,
  value,
  open,
  setOpen,
  hsv,
  hexText,
  hexInvalid,
  supportsEyedropper,
  apply,
  flush,
  changeHex,
  blurHex,
  keyDownHex,
  pickFromScreen,
  disabled,
}: ColorPickerPanelProps) {
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-label={`${label}，当前 ${value}`}
            className="size-8 shrink-0 cursor-pointer rounded-full border border-border outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/40"
            style={{ backgroundColor: value }}
          />
        }
      />
      <PopoverContent side="top" align="end" className="w-[min(16rem,calc(75vw_-_3rem))] gap-3 p-3">
        <PopoverTitle className="sr-only">{label}</PopoverTitle>
        <ColorPickerEditor
          hsv={hsv}
          hexText={hexText}
          hexInvalid={hexInvalid}
          supportsEyedropper={supportsEyedropper}
          apply={apply}
          flush={flush}
          changeHex={changeHex}
          blurHex={blurHex}
          keyDownHex={keyDownHex}
          pickFromScreen={pickFromScreen}
        />
      </PopoverContent>
    </Popover>
  );
}
