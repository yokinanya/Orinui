/**
 * 屏幕取色（吸管）。
 *
 * 平台模块：这里是唯一直接使用 EyeDropper API 的地方。
 * 能力探测与“用户取消”分开处理：取消是正常结果，能力缺失由调用方决定是否显示入口。
 */

interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperInstance {
  open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult>;
}

type EyeDropperConstructor = new () => EyeDropperInstance;

function constructor(): EyeDropperConstructor | null {
  const candidate = (globalThis as { EyeDropper?: unknown }).EyeDropper;
  return typeof candidate === 'function' ? (candidate as EyeDropperConstructor) : null;
}

/** 当前环境是否支持屏幕取色。 */
export function canPickColorFromScreen(): boolean {
  return constructor() !== null;
}

/**
 * 打开吸管取色。
 *
 * 返回取到的 #rrggbb；用户按 Esc 取消时返回 null。
 * 其他失败向上抛出，由调用方提示，不静默吞掉。
 */
export async function pickColorFromScreen(): Promise<string | null> {
  const EyeDropper = constructor();
  if (!EyeDropper) {
    throw new Error('当前浏览器不支持屏幕取色');
  }

  try {
    const result = await new EyeDropper().open();
    return result.sRGBHex.toLowerCase();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}
