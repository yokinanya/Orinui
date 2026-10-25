import { MotionVisual } from '@/features/appearance/MotionVisual';

/**
 * 背景层。
 *
 * 只读取根元素上的语义令牌：照片、纯色与渐变在 applyAppearance 中翻译成
 * --wallpaper / --wallpaper-color，遮罩强度翻译成 --wallpaper-mask。
 * 视频开启合成层：没有独立合成层的视频在页面重绘时会闪烁黑帧。
 */
export function BackgroundLayer() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: 'var(--wallpaper)',
          backgroundColor: 'var(--wallpaper-color)',
        }}
      />
      <div className="absolute inset-0 [contain:paint] [transform:translateZ(0)]">
        <MotionVisual />
        {/* 遮罩与视频同层，在视频合成之后绘制，拖动滑条时不推进色块从视频下方露出而闪一下。 */}
        <div
          data-wallpaper-mask
          className="absolute inset-0 [will-change:background-color]"
          style={{ backgroundColor: 'var(--wallpaper-mask)' }}
        />
      </div>
    </div>
  );
}
