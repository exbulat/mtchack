interface SaveStatusProps {
  isSaving: boolean;
  lastSavedAt: number | null;
  error?: boolean;
  pendingChanges?: boolean;
}

export default function SaveStatus({ isSaving, lastSavedAt, error, pendingChanges }: SaveStatusProps) {
  if (error) {
    return (
      <div className="save-status error" title="Изменения сохранены локально, синхронизация с сервером не удалась">
        ⚠ Ошибка синхронизации (сохранено локально)
      </div>
    );
  }

  if (isSaving) {
    return <div className="save-status saving">⟳ Сохранение…</div>;
  }

  if (pendingChanges) {
    return <div className="save-status pending">● Есть изменения</div>;
  }

  if (!lastSavedAt) {
    return <div className="save-status">Изменений пока нет</div>;
  }

  return (
    <div className="save-status saved">
      ✓ Сохранено {new Date(lastSavedAt).toLocaleTimeString('ru-RU')}
    </div>
  );
}
