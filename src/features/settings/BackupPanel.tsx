import { useRef, useState } from 'react';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useData } from '@/app/data-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError, FieldGroup, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { readBackupFile, type RestorableBackup } from '@/platform/backup-file';
import { downloadBackupFile } from '@/platform/backup-download';

function useBackupActions() {
  const { exportBackup, restoreBackup } = useData();
  const [preview, setPreview] = useState<RestorableBackup | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exportFile = async () => {
    setError(null);
    try { downloadBackupFile(await exportBackup()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const selectFile = async (file: File | undefined) => {
    if (!file) return;
    setPreview(null);
    setError(null);
    try {
      const next = await readBackupFile(file);
      setPreview(next);
      setConfirmOpen(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const confirmImport = async () => {
    if (!preview) throw new Error('请先选择并验证备份文件');
    setBusy(true);
    setError(null);
    try { await restoreBackup(preview); setPreview(null); setConfirmOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return { preview, confirmOpen, setConfirmOpen, error, busy, exportFile, selectFile, confirmImport, clearPreview: () => setPreview(null) };
}

type BackupActions = ReturnType<typeof useBackupActions>;

function ImportConfirmation({ actions }: { readonly actions: BackupActions }) {
  const { preview, confirmOpen, setConfirmOpen, error, busy, confirmImport, clearPreview } = actions;
  return (
    <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!busy) setConfirmOpen(open); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>替换本机数据？</AlertDialogTitle>
          <AlertDialogDescription>
            {preview && `备份包含 ${preview.groupCount} 个分组、${preview.shortcutCount} 个网站、${preview.assetCount} 张图片。默认分组「${preview.defaultGroup}」，默认搜索引擎「${preview.engine}」。`}
            {' '}继续后会覆盖当前数据；联网搜索建议仍保持关闭。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <FieldError role="alert">{error}</FieldError>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={clearPreview}>取消</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void confirmImport(); }}>
            {busy ? '正在导入…' : '确认替换'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function BackupActionRow({ actions }: { readonly actions: BackupActions }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FieldTitle className="mr-auto">本地备份</FieldTitle>
      <Button type="button" variant="outline" size="sm" onClick={() => void actions.exportFile()}>
        <DownloadIcon data-icon="inline-start" />导出 JSON
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={actions.busy}
        onClick={() => input.current?.click()}>
        <UploadIcon data-icon="inline-start" />导入 JSON
      </Button>
      <Input ref={input} id="backup-file" type="file" accept="application/json,.json" className="hidden"
        aria-label="选择本地备份 JSON 文件" disabled={actions.busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void actions.selectFile(file);
        }} />
    </div>
  );
}

export function BackupPanel() {
  const actions = useBackupActions();
  return (
    <FieldGroup className="gap-2">
      <BackupActionRow actions={actions} />
      {actions.error && !actions.confirmOpen && <FieldError role="alert">{actions.error}</FieldError>}
      <ImportConfirmation actions={actions} />
    </FieldGroup>
  );
}
