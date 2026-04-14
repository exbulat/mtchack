import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { api, type PageSummary } from '../lib/api';
import { useSpaces } from '../context/SpaceContext';

export const PagesListContext = createContext<{
  pagesListVersion: number;
  bumpPagesList: () => void;
}>({ pagesListVersion: 0, bumpPagesList: () => {} });

type FolderRecord = {
  id: string;
  name: string;
  expanded: boolean;
  parentId: string | null;
};

type ImportedPagePayload = {
  title?: string;
  icon?: string;
  content?: Record<string, unknown>;
};

type DialogState =
  | { type: 'create-folder'; parentId: string | null; title: string; submitLabel: string; value: string }
  | { type: 'rename-folder'; folderId: string; title: string; submitLabel: string; value: string }
  | { type: 'rename-page'; pageId: string; title: string; submitLabel: string; value: string }
  | null;

type DragItem =
  | { type: 'page'; id: string }
  | { type: 'folder'; id: string }
  | null;

const FOLDER_STORAGE_KEY_PREFIX = 'wikilive-space-folders:';
const ROOT_DROP_ID = '__root__';

export function PagesListProvider({ children }: { children: React.ReactNode }) {
  const [pagesListVersion, setPagesListVersion] = useState(0);
  const bumpPagesList = useCallback(() => setPagesListVersion((value) => value + 1), []);
  return (
    <PagesListContext.Provider value={{ pagesListVersion, bumpPagesList }}>
      {children}
    </PagesListContext.Provider>
  );
}

function sanitizeFileName(value: string): string {
  const normalized = value.trim().replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ').replace(/\s+/g, ' ');
  return normalized || 'page';
}

function downloadJsonFile(fileName: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function readFolderState(storageKey: string | null): { folders: FolderRecord[]; pageToFolder: Record<string, string> } {
  if (!storageKey) {
    return { folders: [], pageToFolder: {} };
  }

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { folders: [], pageToFolder: {} };

    const parsed = JSON.parse(raw) as {
      folders?: Array<Partial<FolderRecord>>;
      pageToFolder?: Record<string, string>;
    };

    const folders = Array.isArray(parsed.folders)
      ? parsed.folders
          .map((folder) => ({
            id: typeof folder.id === 'string' ? folder.id : '',
            name: typeof folder.name === 'string' ? folder.name.trim() : '',
            expanded: folder.expanded !== false,
            parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
          }))
          .filter((folder) => folder.id && folder.name)
      : [];

    const folderIds = new Set(folders.map((folder) => folder.id));
    const normalizedFolders = folders.map((folder) => ({
      ...folder,
      parentId: folder.parentId && folderIds.has(folder.parentId) ? folder.parentId : null,
    }));

    const pageToFolder =
      parsed.pageToFolder && typeof parsed.pageToFolder === 'object'
        ? Object.fromEntries(
            Object.entries(parsed.pageToFolder).filter(
              ([pageId, folderId]) =>
                Boolean(pageId) && typeof folderId === 'string' && folderId.length > 0 && folderIds.has(folderId)
            )
          )
        : {};

    return { folders: normalizedFolders, pageToFolder };
  } catch {
    localStorage.removeItem(storageKey);
    return { folders: [], pageToFolder: {} };
  }
}

function parseImportedPage(raw: unknown): ImportedPagePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const record = raw as Record<string, unknown>;
  const source =
    record.page && typeof record.page === 'object' && !Array.isArray(record.page)
      ? (record.page as Record<string, unknown>)
      : record;

  const title = typeof source.title === 'string' ? source.title.trim() : '';
  const icon = typeof source.icon === 'string' ? source.icon : '';
  const content =
    source.content && typeof source.content === 'object' && !Array.isArray(source.content)
      ? (source.content as Record<string, unknown>)
      : null;

  if (!content) return null;

  return {
    title: title || 'Без названия',
    icon,
    content,
  };
}

function collectDescendantFolderIds(folderId: string, folders: FolderRecord[]): string[] {
  const result: string[] = [];
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) break;
    const children = folders.filter((folder) => folder.parentId === currentId).map((folder) => folder.id);
    result.push(...children);
    queue.push(...children);
  }

  return result;
}

function SidebarModal({
  title,
  value,
  submitLabel,
  onChange,
  onSubmit,
  onClose,
}: {
  title: string;
  value: string;
  submitLabel: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420, padding: 20 }} onClick={(event) => event.stopPropagation()}>
        <h3 style={{ marginBottom: 14 }}>{title}</h3>
        <label className="link-field">
          <span>Название</span>
          <input
            autoFocus
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Введите название"
          />
        </label>
        <div className="link-popover-actions" style={{ marginTop: 18 }}>
          <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={!value.trim()}>
            {submitLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RightSidebar() {
  const { activeSpace } = useSpaces();
  const navigate = useNavigate();
  const params = useParams<{ spaceId?: string; id?: string }>();
  const currentSpaceId = params.spaceId ?? activeSpace?.id;
  const folderStorageKey = currentSpaceId ? `${FOLDER_STORAGE_KEY_PREFIX}${currentSpaceId}` : null;

  const [pages, setPages] = useState<PageSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [pageToFolder, setPageToFolder] = useState<Record<string, string>>({});
  const [openPageMenuId, setOpenPageMenuId] = useState<string | null>(null);
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [dialogState, setDialogState] = useState<DialogState>(null);
  const [dragItem, setDragItem] = useState<DragItem>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { pagesListVersion, bumpPagesList } = useContext(PagesListContext);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);

  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return pages;
    const query = searchQuery.trim().toLowerCase();
    return pages.filter((page) => (page.title || 'Без названия').toLowerCase().includes(query));
  }, [pages, searchQuery]);

  const loadPages = async () => {
    if (!currentSpaceId) return;
    try {
      const data = await api.getSpacePages(currentSpaceId);
      setPages(data);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadPages();
  }, [pagesListVersion, currentSpaceId]);

  useEffect(() => {
    const nextState = readFolderState(folderStorageKey);
    setFolders(nextState.folders);
    setPageToFolder(nextState.pageToFolder);
    setOpenPageMenuId(null);
    setOpenFolderMenuId(null);
    setDialogState(null);
  }, [folderStorageKey]);

  useEffect(() => {
    if (!folderStorageKey) return;
    try {
      localStorage.setItem(folderStorageKey, JSON.stringify({ folders, pageToFolder }));
    } catch {
      // ignore storage failures
    }
  }, [folderStorageKey, folders, pageToFolder]);

  useEffect(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    const folderIds = new Set(folders.map((folder) => folder.id));

    setPageToFolder((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([pageId, folderId]) => pageIds.has(pageId) && folderIds.has(folderId))
      );
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [folders, pages]);

  useEffect(() => {
    if (!openPageMenuId && !openFolderMenuId) return;

    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('.right-sidebar-page-menu') ||
        target.closest('.right-sidebar-folder-menu') ||
        target.closest('.right-sidebar-item-menu-trigger')
      ) {
        return;
      }
      setOpenPageMenuId(null);
      setOpenFolderMenuId(null);
    };

    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [openFolderMenuId, openPageMenuId]);

  const canDropIntoFolder = useCallback(
    (targetFolderId: string | null) => {
      if (!dragItem) return false;
      if (dragItem.type === 'page') {
        return targetFolderId === null || folderMap.has(targetFolderId);
      }
      if (targetFolderId === null) return true;
      if (dragItem.id === targetFolderId) return false;
      const blockedIds = new Set([dragItem.id, ...collectDescendantFolderIds(dragItem.id, folders)]);
      return !blockedIds.has(targetFolderId);
    },
    [dragItem, folderMap, folders]
  );

  const clearDragState = () => {
    setDragItem(null);
    setDropTargetId(null);
  };

  const applyDrop = useCallback(
    (targetFolderId: string | null) => {
      if (!dragItem || !canDropIntoFolder(targetFolderId)) {
        clearDragState();
        return;
      }

      if (dragItem.type === 'page') {
        setPageToFolder((prev) => {
          const next = { ...prev };
          if (!targetFolderId) delete next[dragItem.id];
          else next[dragItem.id] = targetFolderId;
          return next;
        });
      } else {
        setFolders((prev) =>
          prev.map((folder) =>
            folder.id === dragItem.id ? { ...folder, parentId: targetFolderId } : folder
          )
        );
      }

      clearDragState();
    },
    [canDropIntoFolder, dragItem]
  );

  const openCreateFolderDialog = (parentId: string | null = null) => {
    setDialogState({
      type: 'create-folder',
      parentId,
      title: parentId ? 'Новая вложенная папка' : 'Новая папка',
      submitLabel: 'Создать',
      value: '',
    });
    setOpenFolderMenuId(null);
  };

  const createFolder = (name: string, parentId: string | null) => {
    const folder: FolderRecord = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      expanded: true,
      parentId,
    };
    setFolders((prev) => [...prev, folder]);
  };

  const createPage = async () => {
    if (!currentSpaceId) {
      navigate('/');
      return;
    }
    try {
      const page = await api.createSpacePage(currentSpaceId, { title: 'Без названия' });
      bumpPagesList();
      navigate(`/spaces/${currentSpaceId}/page/${page.id}`);
    } catch {
      // ignore
    }
  };

  const renamePage = (page: PageSummary) => {
    setDialogState({
      type: 'rename-page',
      pageId: page.id,
      title: 'Переименовать страницу',
      submitLabel: 'Сохранить',
      value: page.title || 'Без названия',
    });
    setOpenPageMenuId(null);
  };

  const renameFolder = (folder: FolderRecord) => {
    setDialogState({
      type: 'rename-folder',
      folderId: folder.id,
      title: 'Переименовать папку',
      submitLabel: 'Сохранить',
      value: folder.name,
    });
    setOpenFolderMenuId(null);
  };

  const handleDialogSubmit = async () => {
    if (!dialogState) return;
    const nextValue = dialogState.value.trim();
    if (!nextValue) return;

    if (dialogState.type === 'create-folder') {
      createFolder(nextValue, dialogState.parentId);
      setDialogState(null);
      return;
    }

    if (dialogState.type === 'rename-folder') {
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === dialogState.folderId ? { ...folder, name: nextValue } : folder
        )
      );
      setDialogState(null);
      return;
    }

    if (dialogState.type === 'rename-page') {
      try {
        await api.updatePage(dialogState.pageId, { title: nextValue });
        bumpPagesList();
        setDialogState(null);
      } catch {
        // ignore
      }
    }
  };

  const exportPage = async (page: PageSummary) => {
    try {
      const fullPage = await api.getPage(page.id);
      downloadJsonFile(`${sanitizeFileName(fullPage.title)}.wikilive-page.json`, {
        format: 'wikilive-page',
        version: 1,
        exportedAt: new Date().toISOString(),
        page: {
          id: fullPage.id,
          title: fullPage.title,
          icon: fullPage.icon,
          content: fullPage.content,
        },
      });
      setOpenPageMenuId(null);
    } catch {
      // ignore
    }
  };

  const deletePage = async (pageId: string) => {
    try {
      await api.deletePage(pageId);
      setPageToFolder((prev) => {
        const next = { ...prev };
        delete next[pageId];
        return next;
      });
      bumpPagesList();
      setOpenPageMenuId(null);
    } catch {
      // ignore
    }
  };

  const deleteFolder = (folderId: string) => {
    const folder = folderMap.get(folderId);
    if (!folder) return;

    const descendants = collectDescendantFolderIds(folderId, folders);
    const descendantSet = new Set(descendants);

    setFolders((prev) =>
      prev
        .filter((candidate) => candidate.id !== folderId)
        .map((candidate) =>
          candidate.parentId === folderId ? { ...candidate, parentId: folder.parentId } : candidate
        )
    );

    setPageToFolder((prev) => {
      const next: Record<string, string> = {};
      for (const [pageId, assignedFolderId] of Object.entries(prev)) {
        if (assignedFolderId === folderId) {
          if (folder.parentId) next[pageId] = folder.parentId;
          continue;
        }
        if (descendantSet.has(assignedFolderId)) {
          next[pageId] = assignedFolderId;
          continue;
        }
        next[pageId] = assignedFolderId;
      }
      return next;
    });

    setOpenFolderMenuId(null);
  };

  const triggerImport = () => {
    fileInputRef.current?.click();
  };

  const importPage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !currentSpaceId) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const imported = parseImportedPage(parsed);
      if (!imported) {
        window.alert('Не удалось импортировать файл: неподдерживаемый формат.');
        return;
      }

      const created = await api.createSpacePage(currentSpaceId, {
        title: imported.title,
        icon: imported.icon,
        content: imported.content,
      });

      bumpPagesList();
      navigate(`/spaces/${currentSpaceId}/page/${created.id}`);
    } catch {
      window.alert('Импорт не удался. Проверьте, что выбран корректный JSON-файл WikiLive.');
    }
  };

  const renderPageRow = (page: PageSummary, depth: number) => {
    const isActive = params.id === page.id;
    const href = `/spaces/${currentSpaceId}/page/${page.id}`;
    const isMenuOpen = openPageMenuId === page.id;
    const assignedFolderId = pageToFolder[page.id] || null;

    return (
      <div key={page.id} style={{ position: 'relative' }}>
        <NavLink
          to={href}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', `page:${page.id}`);
            setDragItem({ type: 'page', id: page.id });
          }}
          onDragEnd={clearDragState}
          className={() => `right-sidebar-item${isActive ? ' active' : ''}`}
          style={{
            ...nodeRowStyle,
            paddingLeft: 18 + depth * 20,
            background: isActive ? 'var(--accent-dim)' : 'transparent',
            borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
            cursor: 'grab',
            color: 'var(--text)',
          }}
        >
          <span style={nodeMainStyle}>
            <span style={pageIconStyle}>#</span>
            <span style={nodeLabelStyle}>{page.title || 'Без названия'}</span>
          </span>
          <button
            type="button"
            className="right-sidebar-item-menu-trigger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setOpenFolderMenuId(null);
              setOpenPageMenuId((prev) => (prev === page.id ? null : page.id));
            }}
            title="Действия"
            style={menuTriggerStyle(isMenuOpen)}
          >
            ...
          </button>
        </NavLink>

        {isMenuOpen && (
          <div className="right-sidebar-page-menu" style={menuStyle}>
            <button type="button" onClick={() => renamePage(page)} style={menuItemStyle}>
              Переименовать
            </button>
            <button type="button" onClick={() => void exportPage(page)} style={menuItemStyle}>
              Экспортировать данные
            </button>
            {assignedFolderId && (
              <>
                <div style={menuDividerStyle} />
                <button
                  type="button"
                  onClick={() => {
                    setPageToFolder((prev) => {
                      const next = { ...prev };
                      delete next[page.id];
                      return next;
                    });
                    setOpenPageMenuId(null);
                  }}
                  style={menuItemStyle}
                >
                  Убрать из папки
                </button>
              </>
            )}
            <div style={menuDividerStyle} />
            <button type="button" onClick={() => void deletePage(page.id)} style={{ ...menuItemStyle, color: 'var(--danger)' }}>
              Удалить
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderFolderTree = (parentId: string | null, depth: number): React.ReactNode => {
    const nestedFolders = folders
      .filter((folder) => folder.parentId === parentId)
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));

    return nestedFolders.map((folder) => {
      const isMenuOpen = openFolderMenuId === folder.id;
      const folderPages = filteredPages.filter((page) => pageToFolder[page.id] === folder.id);
      const childFolders = folders.filter((candidate) => candidate.parentId === folder.id);
      const hasSearchResults = searchQuery
        ? folderPages.length > 0 || childFolders.some((candidate) => candidate.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : true;

      if (!hasSearchResults && !childFolders.length) {
        return null;
      }

      const canDrop = canDropIntoFolder(folder.id);
      const isDropTarget = dropTargetId === folder.id;

      return (
        <div key={folder.id} style={{ position: 'relative' }}>
          <div
            onDragOver={(event) => {
              if (!canDrop) return;
              event.preventDefault();
              setDropTargetId(folder.id);
            }}
            onDragLeave={() => {
              if (dropTargetId === folder.id) setDropTargetId(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              applyDrop(folder.id);
            }}
            style={{
              ...nodeRowStyle,
              paddingLeft: 14 + depth * 20,
              background: isDropTarget ? 'var(--accent-dim)' : 'transparent',
              boxShadow: isDropTarget ? 'inset 0 0 0 1px var(--accent-border)' : 'none',
            }}
          >
            <button
              type="button"
              onClick={() =>
                setFolders((prev) =>
                  prev.map((candidate) =>
                    candidate.id === folder.id ? { ...candidate, expanded: !candidate.expanded } : candidate
                  )
                )
              }
              style={folderToggleButtonStyle}
            >
              {folder.expanded ? '▾' : '▸'}
            </button>
            <div
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', `folder:${folder.id}`);
                setDragItem({ type: 'folder', id: folder.id });
              }}
              onDragEnd={clearDragState}
              style={folderDragHandleStyle}
            >
              <span style={folderIconStyle}>🗂</span>
              <span style={nodeLabelStyle}>{folder.name}</span>
            </div>
            <button
              type="button"
              className="right-sidebar-item-menu-trigger"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setOpenPageMenuId(null);
                setOpenFolderMenuId((prev) => (prev === folder.id ? null : folder.id));
              }}
              title="Действия папки"
              style={menuTriggerStyle(isMenuOpen)}
            >
              ...
            </button>
          </div>

          {isMenuOpen && (
            <div className="right-sidebar-folder-menu" style={menuStyle}>
              <button type="button" onClick={() => openCreateFolderDialog(folder.id)} style={menuItemStyle}>
                Создать вложенную папку
              </button>
              <button type="button" onClick={() => renameFolder(folder)} style={menuItemStyle}>
                Переименовать
              </button>
              <div style={menuDividerStyle} />
              <button type="button" onClick={() => applyDrop(null)} style={menuItemStyle}>
                В корень
              </button>
              <div style={menuDividerStyle} />
              <button type="button" onClick={() => deleteFolder(folder.id)} style={{ ...menuItemStyle, color: 'var(--danger)' }}>
                Удалить папку
              </button>
            </div>
          )}

          {folder.expanded && (
            <>
              {renderFolderTree(folder.id, depth + 1)}
              {folderPages.map((page) => renderPageRow(page, depth + 1))}
            </>
          )}
        </div>
      );
    });
  };

  const rootPages = filteredPages.filter((page) => !pageToFolder[page.id]);
  const hasRootDrop = canDropIntoFolder(null);

  if (!currentSpaceId) {
    return (
      <aside style={emptyStateAsideStyle}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', textAlign: 'center' }}>
          Выберите или создайте пространство
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/')} style={{ fontSize: 12, padding: '6px 14px', marginTop: 8 }}>
          + Создать
        </button>
      </aside>
    );
  }

  return (
    <>
      <aside style={sidebarStyle}>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json,.wikilive-page.json"
          style={{ display: 'none' }}
          onChange={(event) => void importPage(event)}
        />

        <div style={spaceCardStyle}>
          <div>
            <div style={spaceLabelStyle}>Проводник</div>
            <div style={spaceTitleStyle}>{activeSpace?.name ?? 'Пространство'}</div>
          </div>
          <button
            onClick={() => setShowSearch((value) => !value)}
            title="Поиск"
            style={searchToggleStyle(showSearch)}
          >
            🔍
          </button>
        </div>

        {showSearch && (
          <div style={{ padding: '10px 12px 0' }}>
            <input
              autoFocus
              placeholder="Поиск страниц и папок..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              style={searchInputStyle}
            />
          </div>
        )}

        <div style={topActionsRowStyle}>
          <button type="button" onClick={() => void createPage()} style={topActionStyle}>
            + Добавить
          </button>
          <button type="button" onClick={triggerImport} style={topActionStyle}>
            Импорт
          </button>
          <button type="button" onClick={() => openCreateFolderDialog(null)} style={topActionStyle}>
            Папка
          </button>
        </div>

        <div
          style={treeContainerStyle}
          onDragOver={(event) => {
            if (!hasRootDrop) return;
            event.preventDefault();
            setDropTargetId(ROOT_DROP_ID);
          }}
          onDragLeave={() => {
            if (dropTargetId === ROOT_DROP_ID) setDropTargetId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            applyDrop(null);
          }}
        >
          {dragItem && (
            <div
              style={{
                ...rootDropHintStyle,
                borderColor: dropTargetId === ROOT_DROP_ID ? 'var(--accent)' : 'var(--border)',
                background: dropTargetId === ROOT_DROP_ID ? 'var(--accent-dim)' : 'transparent',
                color: dropTargetId === ROOT_DROP_ID ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              Перетащите сюда, чтобы переместить объект в корень
            </div>
          )}

          {filteredPages.length === 0 && folders.length === 0 ? (
            <div style={emptyContentStyle}>
              Нет страниц. Нажмите «+ Добавить», импортируйте файл или создайте папку.
            </div>
          ) : (
            <>
              {renderFolderTree(null, 0)}
              {rootPages.map((page) => renderPageRow(page, 0))}
            </>
          )}
        </div>

        <div style={sidebarFooterStyle}>
          <NavLink to="/trash" style={footerLinkStyle}>
            Корзина
          </NavLink>
          <NavLink to="/graph" style={footerLinkStyle}>
            Граф связей
          </NavLink>
        </div>
      </aside>

      {dialogState && (
        <SidebarModal
          title={dialogState.title}
          submitLabel={dialogState.submitLabel}
          value={dialogState.value}
          onChange={(nextValue) => setDialogState((prev) => (prev ? { ...prev, value: nextValue } : prev))}
          onSubmit={() => void handleDialogSubmit()}
          onClose={() => setDialogState(null)}
        />
      )}
    </>
  );
}

const sidebarStyle: CSSProperties = {
  width: 280,
  flexShrink: 0,
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 92%, var(--surface) 8%) 0%, var(--bg-secondary) 100%)',
  borderRight: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  color: 'var(--text)',
  fontSize: 14,
};

const emptyStateAsideStyle: CSSProperties = {
  width: 280,
  flexShrink: 0,
  background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-secondary) 92%, var(--surface) 8%) 0%, var(--bg-secondary) 100%)',
  borderRight: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  gap: 8,
};

const spaceCardStyle: CSSProperties = {
  margin: '12px 12px 0',
  padding: '12px 12px 10px',
  borderRadius: 16,
  background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
  border: '1px solid var(--border)',
  boxShadow: '0 10px 24px color-mix(in srgb, var(--bg) 18%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const spaceLabelStyle: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text-muted)',
  marginBottom: 4,
};

const spaceTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const searchInputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  fontSize: 13,
  fontFamily: 'var(--font)',
  background: 'var(--surface)',
  color: 'var(--text)',
  outline: 'none',
};

const topActionsRowStyle: CSSProperties = {
  margin: '10px 12px 0',
  padding: '6px 8px',
  display: 'flex',
  gap: 4,
  borderRadius: 14,
  background: 'color-mix(in srgb, var(--surface) 78%, transparent)',
  border: '1px solid var(--border)',
};

const topActionStyle: CSSProperties = {
  padding: '8px 10px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  borderRadius: 10,
};

const treeContainerStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '12px',
};

const rootDropHintStyle: CSSProperties = {
  marginBottom: 10,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px dashed',
  fontSize: 12,
  transition: 'all 0.15s ease',
};

const emptyContentStyle: CSSProperties = {
  padding: '18px 12px',
  color: 'var(--text-muted)',
  fontSize: 13,
  lineHeight: 1.5,
};

const nodeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 38,
  padding: '0 10px',
  borderRadius: 12,
  marginBottom: 2,
  transition: 'background 0.15s ease, box-shadow 0.15s ease',
};

const nodeMainStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  overflow: 'hidden',
  flex: 1,
};

const nodeLabelStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  color: 'var(--text)',
};

const pageIconStyle: CSSProperties = {
  width: 18,
  height: 18,
  borderRadius: 6,
  background: 'var(--accent-dim)',
  color: 'var(--accent)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 12,
  flexShrink: 0,
};

const folderIconStyle: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 6,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const folderToggleButtonStyle: CSSProperties = {
  width: 18,
  height: 18,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-muted)',
  padding: 0,
  cursor: 'pointer',
  flexShrink: 0,
};

const folderDragHandleStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  cursor: 'grab',
};

const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 36,
  right: 8,
  zIndex: 30,
  width: 226,
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--surface) 92%, transparent)',
  boxShadow: '0 18px 40px color-mix(in srgb, var(--bg) 26%, transparent)',
  padding: 8,
  backdropFilter: 'blur(10px)',
};

const menuItemStyle: CSSProperties = {
  width: '100%',
  padding: '9px 10px',
  border: 'none',
  background: 'transparent',
  borderRadius: 10,
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--text)',
  fontSize: 13,
};

const menuDividerStyle: CSSProperties = {
  height: 1,
  background: 'var(--border)',
  margin: '6px 0',
};

const sidebarFooterStyle: CSSProperties = {
  padding: '8px 14px 14px',
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const footerLinkStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-muted)',
  padding: '4px 0',
  textDecoration: 'none',
};

function searchToggleStyle(active: boolean): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-dim)' : 'var(--surface)',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 15,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: active ? '0 10px 24px color-mix(in srgb, var(--accent) 14%, transparent)' : 'none',
  };
}

function menuTriggerStyle(active: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 8,
    border: 'none',
    background: active ? 'var(--accent-dim)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-muted)',
    cursor: 'pointer',
    flexShrink: 0,
    fontWeight: 700,
  };
}
