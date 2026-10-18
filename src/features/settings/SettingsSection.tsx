import type { ReactNode } from 'react';

interface SettingsSectionProps {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}

export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section aria-label={title} className="settings-section flex min-w-0 flex-col gap-5 rounded-xl border border-border/50 bg-background/45 p-4 sm:p-5">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </header>
      {children}
    </section>
  );
}
