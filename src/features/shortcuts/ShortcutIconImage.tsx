import type { CSSProperties } from 'react';

interface ShortcutIconImageProps {
  readonly url: string;
  readonly mime: string;
  readonly color: string | null;
  readonly alt: string;
  readonly className?: string;
  readonly style?: CSSProperties;
}

function svgMaskStyle(url: string, color: string, style: CSSProperties): CSSProperties {
  const mask = `url(${JSON.stringify(url)})`;
  return {
    ...style,
    backgroundColor: color,
    maskImage: mask,
    maskPosition: 'center',
    maskRepeat: 'no-repeat',
    maskSize: 'contain',
    WebkitMaskImage: mask,
    WebkitMaskPosition: 'center',
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
  };
}

export function ShortcutIconImage({ url, mime, color, alt, className, style = {} }: ShortcutIconImageProps) {
  if (mime === 'image/svg+xml' && color) {
    return <span role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true}
      className={className} style={svgMaskStyle(url, color, style)} />;
  }
  return <img src={url} alt={alt} className={className} style={style} />;
}
