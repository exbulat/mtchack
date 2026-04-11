import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BacklinkPage } from '../lib/api';

interface BacklinksProps {
  pageId: string;
}

export default function Backlinks({ pageId }: BacklinksProps) {
  const [links, setLinks] = useState<BacklinkPage[]>([]);

  useEffect(() => {
    let isMounted = true;

    api
      .getBacklinks(pageId)
      .then((data) => {
        if (isMounted) setLinks(data);
      })
      .catch(() => {
        if (isMounted) setLinks([]);
      });

    return () => {
      isMounted = false;
    };
  }, [pageId]);

  return (
    <section className="backlinks">
      <div className="backlinks-title">Обратные ссылки</div>
      {links.length === 0 ? (
        <div className="backlinks-empty">Нет обратных ссылок</div>
      ) : (
        <div className="backlinks-list">
          {links.map((item) => (
            <Link key={item.id} className="backlinks-item" to={`/page/${item.id}`}>
              {item.title || 'Без названия'}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
