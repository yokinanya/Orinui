const FILE_URL_REVOKE_MS = 1_000;
const ISO_DATE_CHARACTERS = 10;

/** Browser download effects live at the platform boundary, outside the settings form. */
export function downloadBackupFile(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `orinui-${new Date().toISOString().slice(0, ISO_DATE_CHARACTERS)}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), FILE_URL_REVOKE_MS);
}
