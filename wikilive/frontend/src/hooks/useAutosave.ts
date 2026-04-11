import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface UseAutosaveArgs {
  pageId: string | null;
  title: string;
  content: Record<string, unknown>;
}

export function useAutosave({ pageId, title, content }: UseAutosaveArgs) {
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const saveNow = useCallback(async () => {
    if (!pageId) return;
    const key = `wikilive-page-${pageId}`;
    setIsSaving(true);
    try {
      localStorage.setItem(key, JSON.stringify({ title, content, updatedAt: Date.now() }));
      await api.updatePage(pageId, { title, content });
      setSaveError(false);
      setLastSavedAt(Date.now());
    } catch {
      setSaveError(true);
    } finally {
      setIsSaving(false);
    }
  }, [pageId, title, content]);

  // таймер сбрасывается на каждое изменение — сохраняем после паузы в наборе
  useEffect(() => {
    if (!pageId) return;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => void saveNow(), 1500);
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [pageId, saveNow]);

  return { isSaving, lastSavedAt, saveError, saveNow };
}
