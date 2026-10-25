import { useState } from 'react';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MotionBackgroundPanel } from '@/features/settings/MotionBackgroundPanel';
import { PhotoBackgroundPanel } from '@/features/settings/PhotoBackgroundPanel';

export function WallpaperUploadPanel() {
  const [kind, setKind] = useState('photo');
  const [busy, setBusy] = useState(false);
  return <FieldGroup>
    <Field>
      <FieldLabel id="wallpaper-upload-kind">素材类型</FieldLabel>
      <ToggleGroup aria-labelledby="wallpaper-upload-kind" className="settings-segmented" value={[kind]} disabled={busy}
        onValueChange={(value) => { if (value[0]) setKind(value[0]); }}>
        <ToggleGroupItem value="photo">照片</ToggleGroupItem>
        <ToggleGroupItem value="motion">动态壁纸</ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription>上传或主动下载后加入素材库并应用；已有壁纸不会被删除。</FieldDescription>
    </Field>
    {kind === 'photo' ? <PhotoBackgroundPanel fresh onBusyChange={setBusy} />
      : <MotionBackgroundPanel fresh onBusyChange={setBusy} />}
  </FieldGroup>;
}
