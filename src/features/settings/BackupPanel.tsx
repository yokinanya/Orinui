import { useRef, useState } from 'react';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useData } from '@/app/data-context';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldError, FieldGroup, FieldTitle } from '@/components/ui/field';
import { BackupContentsPreview } from '@/features/settings/BackupContentsPreview';
import { Input } from '@/components/ui/input';
import { readBackupFile, type RestorableBackup } from '@/platform/backup-file';
import { downloadBackupFile } from '@/platform/backup-download';
import { useOperations } from '@/app/operations';
import { useWebDavSync } from '@/app/webdav-sync-context';
import { useS3Sync } from '@/app/s3-sync-context';
import type { OperationValue } from '@/app/operations';

interface BackupActionDependencies {
  readonly setBusy: (busy: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly begin: OperationValue['begin'];
}

async function exportZip(input: BackupActionDependencies & { readonly exportBackup: () => Promise<Blob> }): Promise<void> {
  input.setError(null); input.setBusy(true);
  const task = input.begin('导出完整 ZIP 备份', '收集本机数据');
  try {
    const archive = await input.exportBackup();
    task.update('生成并下载 ZIP'); downloadBackupFile(archive); task.succeed('ZIP 已生成并开始下载');
  } catch (cause) { task.fail(cause); input.setError(errorText(cause)); }
  finally { input.setBusy(false); }
}

async function validateZip(input: BackupActionDependencies & { readonly file: File | undefined;
  readonly setPreview: (preview: RestorableBackup | null) => void;
  readonly setConfirmOpen: (open: boolean) => void }): Promise<void> {
  if (!input.file) return;
  input.setPreview(null); input.setError(null); input.setBusy(true);
  const task = input.begin('验证 ZIP 备份', '读取清单并校验媒体');
  try {
    const next = await readBackupFile(input.file); input.setPreview(next); input.setConfirmOpen(true);
    task.succeed(`验证完成，共 ${next.assetCount} 个媒体文件`);
  } catch (cause) { task.fail(cause); input.setError(errorText(cause)); }
  finally { input.setBusy(false); }
}

async function importZip(input: BackupActionDependencies & { readonly preview: RestorableBackup | null;
  readonly restoreBackup: (backup: RestorableBackup) => Promise<void>;
  readonly setPreview: (preview: RestorableBackup | null) => void;
  readonly setConfirmOpen: (open: boolean) => void }): Promise<void> {
  if (!input.preview) throw new Error('请先选择并验证备份文件');
  input.setBusy(true); input.setError(null);
  const task = input.begin('恢复 ZIP 备份', '恢复本机数据');
  try {
    await input.restoreBackup(input.preview); input.setPreview(null); input.setConfirmOpen(false);
    task.succeed('本机数据已恢复');
  } catch (cause) { task.fail(cause); input.setError(errorText(cause)); }
  finally { input.setBusy(false); }
}

function errorText(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }

function useBackupActions() {
  const { exportBackup, restoreBackup } = useData();
  const operations = useOperations();
  const sync = useWebDavSync();
  const s3Sync = useS3Sync();
  const [preview, setPreview] = useState<RestorableBackup | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dependencies = { setBusy, setError, begin: operations.begin };
  const exportFile = () => exportZip({ ...dependencies, exportBackup });
  const selectFile = (file: File | undefined) => validateZip({ ...dependencies, file, setPreview, setConfirmOpen });
  const confirmImport = () => importZip({ ...dependencies, preview, restoreBackup, setPreview, setConfirmOpen });
  return { preview, confirmOpen, setConfirmOpen, error, busy, syncConfigured: sync.status !== null || s3Sync.status !== null,
    exportFile, selectFile, confirmImport, clearPreview: () => setPreview(null) };
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
            {preview && <BackupContentsPreview backup={preview} />}
            {' '}继续后会完整替换当前数据。{actions.syncConfigured && '恢复数据会参与后续跨设备同步。'}
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
      <Button type="button" variant="outline" size="sm" disabled={actions.busy} onClick={() => void actions.exportFile()}>
        <DownloadIcon data-icon="inline-start" />导出 ZIP
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={actions.busy}
        onClick={() => input.current?.click()}>
        <UploadIcon data-icon="inline-start" />导入 ZIP
      </Button>
      <Input ref={input} id="backup-file" type="file" accept="application/zip,.zip" className="hidden"
        aria-label="选择本地 ZIP 备份文件" disabled={actions.busy}
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
      <FieldDescription>完整 ZIP 包含全库壁纸素材与图标、网站与文件夹、便签与待办、设置。ZIP 默认不加密，请妥善保管。</FieldDescription>
      {actions.error && !actions.confirmOpen && <FieldError role="alert">{actions.error}</FieldError>}
      <ImportConfirmation actions={actions} />
    </FieldGroup>
  );
}
