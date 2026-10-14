import { useState } from 'react';
import { useWebDavSync } from '@/app/webdav-sync-context';
import { getWebDavTemplate, type WebDavTemplate } from '@/features/settings/webdav-templates';

const DEFAULT_TEMPLATE = getWebDavTemplate('jianguoyun');

export function useWebDavConnection() {
  const sync = useWebDavSync();
  const [templateId, setTemplateId] = useState<WebDavTemplate['id']>(DEFAULT_TEMPLATE.id);
  const [url, setUrl] = useState<string>(DEFAULT_TEMPLATE.url);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);

  const prepare = async () => {
    setKeyAcknowledged(false);
    const prepared = await sync.prepare({ credentials: { url, username, password },
      consistencyMode: getWebDavTemplate(templateId).consistencyMode, ...(recoveryKey ? { recoveryKey } : {}) });
    if (!prepared) return false;
    setRecoveryKey('');
    return true;
  };

  const connect = async () => {
    const connected = await sync.connect();
    if (!connected) return false;
    setPassword('');
    setRecoveryKey('');
    setKeyAcknowledged(false);
    return true;
  };

  const cancel = () => {
    sync.cancelPlan();
    setRecoveryKey('');
    setKeyAcknowledged(false);
  };
  const invalidatePlan = () => { sync.cancelPlan(); setKeyAcknowledged(false); };

  const selectTemplate = (template: WebDavTemplate) => {
    if (template.id === templateId) return;
    cancel();
    setTemplateId(template.id);
    setUrl(template.url);
    setUsername('');
    setPassword('');
  };

  return {
    ...sync,
    template: getWebDavTemplate(templateId), selectTemplate,
    url, setUrl: (value: string) => { invalidatePlan(); setUrl(value); },
    username, setUsername: (value: string) => { invalidatePlan(); setUsername(value); },
    password, setPassword: (value: string) => { invalidatePlan(); setPassword(value); },
    recoveryKey, setRecoveryKey: (value: string) => { invalidatePlan(); setRecoveryKey(value); },
    keyAcknowledged, setKeyAcknowledged,
    prepare, connect, cancel,
  };
}
