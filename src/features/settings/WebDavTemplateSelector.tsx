import { Field, FieldDescription, FieldTitle } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getWebDavTemplate, WEBDAV_TEMPLATES, type WebDavTemplate } from '@/features/settings/webdav-templates';

interface WebDavTemplateSelectorProps {
  readonly template: WebDavTemplate;
  readonly disabled: boolean;
  readonly onSelect: (template: WebDavTemplate) => void;
}

export function WebDavTemplateSelector({ template, disabled, onSelect }: WebDavTemplateSelectorProps) {
  return (
    <Field data-disabled={disabled}>
      <FieldTitle id="webdav-template-label">服务模板</FieldTitle>
      <ToggleGroup className="grid w-full grid-cols-2" variant="outline" size="sm" multiple={false}
        aria-labelledby="webdav-template-label" aria-describedby={template.helpUrl ? 'webdav-template-help' : undefined}
        value={[template.id]} disabled={disabled} onValueChange={(values) => {
          const id = values[0];
          if (id !== undefined) onSelect(getWebDavTemplate(id));
        }}>
        {WEBDAV_TEMPLATES.map((option) => (
          <ToggleGroupItem key={option.id} value={option.id} className="min-w-0" title={option.label}>
            <span className="truncate">{option.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {template.helpUrl && (
        <FieldDescription id="webdav-template-help">
          {template.instructions}{' '}
          <a href={template.helpUrl} target="_blank" rel="noopener noreferrer">设置方法</a>
        </FieldDescription>
      )}
    </Field>
  );
}
