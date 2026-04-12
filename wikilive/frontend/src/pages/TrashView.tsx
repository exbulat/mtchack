import { useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { PagesListContext } from '../components/RightSidebar';

interface TrashItem {
  id: string;
  title: string;
  icon: string;
  deletedAt: string;
}

export default function TrashView() {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { bumpPagesList } = useContext(PagesListContext);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listTrash();
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const restore = async (id: string) => {
    await api.restorePage(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
    bumpPagesList();
  };

  const permanentDelete = async (id: string) => {
    await api.permanentDeletePage(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
    bumpPagesList();
  };

  if (loading) {
    return <div className="loading">Загрузка корзины...</div>;
  }

  return (
    <div className="trash-view">
      <h2 className="trash-title">Корзина</h2>
      {items.length === 0 ? (
        <div className="trash-empty">Корзина пуста</div>
      ) : (
        <ul className="trash-list">
          {items.map((item) => (
            <li key={item.id} className="trash-item">
              <div className="trash-item-info">
                <div>
                  <div className="trash-item-title">{item.title || 'Без названия'}</div>
                  <div className="trash-item-date">
                    Удалено {new Date(item.deletedAt).toLocaleString('ru-RU')}
                  </div>
                </div>
              </div>
              <div className="trash-item-actions">
                <button className="btn btn-primary" onClick={() => restore(item.id)}>
                  Восстановить
                </button>
                <button className="btn btn-danger" onClick={() => permanentDelete(item.id)}>
                  Удалить навсегда
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
