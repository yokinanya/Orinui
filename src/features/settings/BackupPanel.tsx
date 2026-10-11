import { useState } from 'react';
import { DownloadIcon } from 'lucide-react';
import { useData } from '@/app/data-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { BACKUP_JSON_LIMIT } from '@/domain/backup';
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

function ImportFileField({ actions }: { readonly actions: BackupActions }) {
  return (
    <Field data-invalid={actions.error !== null || undefined}>
      <FieldLabel htmlFor="backup-file">导入 JSON</FieldLabel>
      <Input id="backup-file" type="file" accept="application/json,.json" disabled={actions.busy}
        aria-invalid={actions.error !== null || undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          void actions.selectFile(file);
        }} />
      <FieldDescription>文件最大 70 MiB；图片总量最大 50 MiB。导入前会显示内容摘要并要求确认。</FieldDescription>
      {actions.error && <FieldError role="alert">{actions.error}</FieldError>}
    </Field>
  );
}

export function BackupPanel() {
  const actions = useBackupActions();
  return (
    <FieldGroup>
      <Field>
        <FieldLabel>备份文件</FieldLabel>
        <FieldDescription>导出内容包含网站、分组、设置和图片。导入会完整替换本机数据。</FieldDescription>
        <Button type="button" variant="outline" onClick={() => void actions.exportFile()}>
          <DownloadIcon data-icon="inline-start" />导出 JSON
        </Button>
      </Field>
      <ImportFileField actions={actions} />
      <ImportConfirmation actions={actions} />
    </FieldGroup>
  );
}
