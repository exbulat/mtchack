interface SaveStatusProps {
  isSaving: boolean;
  lastSavedAt: number | null;
  error?: boolean;
}

export default function SaveStatus({ isSaving, lastSavedAt, error }: SaveStatusProps) {
  if (error) {
    return <div className="save-status error">Ошибка сохранения</div>;
  }

  if (isSaving) {
    return <div className="save-status saving">Сохранение...</div>;
  }

  if (!lastSavedAt) {
    return <div className="save-status">Изменений пока нет</div>;
  }

  return (
    <div className="save-status saved">
      Сохранено {new Date(lastSavedAt).toLocaleTimeString('ru-RU')}
    </div>
  );
}
