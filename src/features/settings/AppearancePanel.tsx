import { useState } from 'react';

import { useData } from '@/app/data-context';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { NEUTRAL_SEED, type BackgroundKind, type ThemeMode } from '@/domain/appearance';
import { ColorPicker } from '@/features/appearance/ColorPicker';
import { contrastHint } from '@/features/appearance/background-style';
import { notifyError } from '@/lib/notify';

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const BACKGROUND_OPTIONS: { value: BackgroundKind; label: string }[] = [
  { value: 'default', label: '默认' },
  { value: 'solid', label: '纯色' },
  { value: 'gradient', label: '渐变' },
];

/** 与视觉规格一致：动态色只作轻强调，颜色只影响强调色与半透明表面。 */
export function AppearancePanel() {
  const { settings, updateAppearance, isDark } = useData();
  const { appearance } = settings;
  const [seedDraft, setSeedDraft] = useState(appearance.dynamicColor.seed ?? NEUTRAL_SEED);

  const background = appearance.background;
  const gradient = background.kind === 'gradient' ? background : null;
  const hint = contrastHint(background, isDark);

  const update = (patch: Parameters<typeof updateAppearance>[0]) => {
    void updateAppearance(patch).catch(notifyError);
  };

  return (
    <div className="flex flex-col gap-6">
      <Field>
        <FieldLabel>主题</FieldLabel>
        <ToggleGroup
          value={[appearance.theme]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === 'system' || next === 'light' || next === 'dark') {
              update({ theme: next });
            }
          }}
        >
          {THEME_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <Separator />

      <Field>
        <FieldLabel>背景</FieldLabel>
        <ToggleGroup
          value={[appearance.background.kind]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === 'default') update({ background: { kind: 'default' } });
            if (next === 'solid') update({ background: { kind: 'solid', color: '#f2ece3' } });
            if (next === 'gradient') {
              update({ background: { kind: 'gradient', from: '#f4efe6', to: '#c9d6e4', angle: 160 } });
            }
          }}
        >
          {BACKGROUND_OPTIONS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FieldDescription>照片背景需要先导入图片，正在实现中。</FieldDescription>
        {hint !== null && <FieldDescription>{hint}</FieldDescription>}
      </Field>

      {background.kind === 'solid' && (
        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="background-color">背景颜色</FieldLabel>
            <ColorPicker
              id="background-color"
              label="背景颜色"
              value={background.color}
              onChange={(color) => update({ background: { kind: 'solid', color } })}
            />
          </div>
        </Field>
      )}

      {gradient && (
        <div className="flex flex-col gap-4">
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="gradient-from">起始颜色</FieldLabel>
              <ColorPicker
                id="gradient-from"
                label="起始颜色"
                value={gradient.from}
                onChange={(from) => update({ background: { ...gradient, from } })}
              />
            </div>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor="gradient-to">结束颜色</FieldLabel>
              <ColorPicker
                id="gradient-to"
                label="结束颜色"
                value={gradient.to}
                onChange={(to) => update({ background: { ...gradient, to } })}
              />
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="gradient-angle">方向（度）</FieldLabel>
            <Input
              id="gradient-angle"
              type="number"
              min={0}
              max={360}
              value={gradient.angle}
              onChange={(event) => {
                const angle = Number(event.target.value);
                if (Number.isFinite(angle) && angle >= 0 && angle <= 360) {
                  update({ background: { ...gradient, angle } });
                }
              }}
            />
          </Field>
        </div>
      )}

      <Separator />

      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor="dynamic-color">跟随背景取色</FieldLabel>
          <Switch
            id="dynamic-color"
            checked={appearance.dynamicColor.enabled}
            onCheckedChange={(checked) => update({ dynamicColor: { ...appearance.dynamicColor, enabled: checked } })}
          />
        </div>
        <FieldDescription>在设备本地从当前背景提取强调色，图片不会上传。</FieldDescription>
      </Field>

      {appearance.dynamicColor.enabled && (
        <>
          <Field>
            <FieldLabel>取色方式</FieldLabel>
            <ToggleGroup
              value={[appearance.dynamicColor.mode]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === 'follow') {
                  update({ dynamicColor: { ...appearance.dynamicColor, mode: 'follow', seed: null } });
                }
                if (next === 'locked') {
                  update({ dynamicColor: { ...appearance.dynamicColor, mode: 'locked', seed: seedDraft } });
                }
              }}
            >
              <ToggleGroupItem value="follow">跟随背景</ToggleGroupItem>
              <ToggleGroupItem value="locked">手动选色</ToggleGroupItem>
            </ToggleGroup>
          </Field>

          {appearance.dynamicColor.mode === 'locked' && (
            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="seed-color">种子色</FieldLabel>
                <ColorPicker
                  id="seed-color"
                  label="种子色"
                  value={appearance.dynamicColor.seed ?? seedDraft}
                  onChange={(seed) => {
                    setSeedDraft(seed);
                    update({ dynamicColor: { ...appearance.dynamicColor, mode: 'locked', seed } });
                  }}
                />
              </div>
            </Field>
          )}
        </>
      )}
    </div>
  );
}
