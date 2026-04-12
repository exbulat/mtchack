import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BacklinkPage } from '../lib/api';

interface BacklinksProps {
  pageId: string;
  currentSpaceId?: string | null;
}

export default function Backlinks({ pageId, currentSpaceId }: BacklinksProps) {
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
          {links.map((item) => {
            const href = item.spaceId
              ? `/spaces/${item.spaceId}/page/${item.id}`
              : currentSpaceId
                ? `/spaces/${currentSpaceId}/page/${item.id}`
                : `/page/${item.id}`;

            return (
              <Link key={item.id} className="backlinks-item" to={href}>
                {item.title || 'Без названия'}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
