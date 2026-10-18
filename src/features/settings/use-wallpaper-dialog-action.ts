import { useState } from 'react';

export function useWallpaperDialogAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, onSuccess: () => void): Promise<void> => {
    setBusy(true);
    setError(null);
    try { await action(); onSuccess(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return { busy, error, run, clearError: () => setError(null) };
}
