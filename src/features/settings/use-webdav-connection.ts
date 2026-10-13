import { useState } from 'react';
import { useWebDavSync } from '@/app/webdav-sync-context';

export function useWebDavConnection() {
  const sync = useWebDavSync();
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [keyAcknowledged, setKeyAcknowledged] = useState(false);

  const prepare = async () => {
    setKeyAcknowledged(false);
    const prepared = await sync.prepare({ credentials: { url, username, password }, ...(recoveryKey ? { recoveryKey } : {}) });
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

  return {
    ...sync,
    url, setUrl,
    username, setUsername,
    password, setPassword,
    recoveryKey, setRecoveryKey,
    keyAcknowledged, setKeyAcknowledged,
    prepare, connect, cancel,
  };
}
