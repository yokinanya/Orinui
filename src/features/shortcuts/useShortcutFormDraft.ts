import { useEffect, useRef, useState } from 'react';
import { useShortcutDraft, type ShortcutFormProps } from '@/features/shortcuts/use-shortcut-draft';

/** 连续添加只改变本次表单行为；普通保存仍沿用调用方的关闭回调。 */
export function useShortcutFormDraft(props: ShortcutFormProps) {
  const [formVersion, setFormVersion] = useState(0);
  const urlRef = useRef<HTMLInputElement>(null);
  const continueAdding = useRef(false);
  const draft = useShortcutDraft({ ...props, onOpenChange: (open) => {
    if (open || !continueAdding.current || props.shortcut) {
      props.onOpenChange(open);
      return;
    }
    draft.setTitle('');
    draft.setUrl('');
    draft.initializeIcon(undefined);
    setFormVersion((version) => version + 1);
  } });
  useEffect(() => {
    if (formVersion > 0) urlRef.current?.focus();
  }, [formVersion]);
  const saveAndContinue = async () => {
    continueAdding.current = true;
    try { await draft.submit(); }
    finally { continueAdding.current = false; }
  };
  return { draft, formVersion, urlRef, saveAndContinue };
}
