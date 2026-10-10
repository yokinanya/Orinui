/**
 * 背景层。
 *
 * 只读取根元素上的语义令牌：照片、纯色与渐变在 applyAppearance 中翻译成
 * --wallpaper / --wallpaper-color，遮罩强度翻译成 --wallpaper-mask。
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
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'var(--wallpaper-mask)' }}
      />
    </div>
  );
}
