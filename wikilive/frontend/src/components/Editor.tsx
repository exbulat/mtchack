import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Link from '@tiptap/extension-link';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import { Node, mergeAttributes, type Editor as TiptapEditor, type JSONContent } from '@tiptap/core';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { useNavigate } from 'react-router-dom';
import SlashMenu, { SLASH_ITEMS, SlashItem } from './SlashMenu';
import TableEmbed from './TableEmbed';
import { WikiLink } from '../extensions/WikiLink';
import { api } from '../lib/api';

function MwsTableNodeView(props: NodeViewProps) {
  const dstId = props.node.attrs.dstId as string;
  const title = (props.node.attrs.title as string) || '';
  return (
    <NodeViewWrapper className="mws-table-node-view" data-drag-handle="">
      <TableEmbed dstId={dstId} title={title} />
    </NodeViewWrapper>
  );
}

// встраиваемая mws-таблица как отдельный блок документа
const MwsTableExtension = Node.create({
  name: 'mwsTable',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      dstId: { default: '' },
      title: { default: '' },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-mws-table]',
        getAttrs: (el) => {
          const node = el as HTMLElement;
          return {
            dstId: node.getAttribute('data-dst-id') || '',
            title: node.getAttribute('data-title') || '',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-mws-table': '',
        'data-dst-id': HTMLAttributes.dstId,
        'data-title': HTMLAttributes.title,
      }),
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MwsTableNodeView);
  },
});

// убираем / перед курсором
function consumeSlashBeforeCursor(editor: TiptapEditor) {
  const { from } = editor.state.selection;
  if (from < 1) return;
  const ch = editor.state.doc.textBetween(from - 1, from, '');
  if (ch === '/') {
    editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();
  }
}

const TABLE_GRID_MAX = 6;

export interface EditorCollab {
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
}

interface EditorProps {
  content: JSONContent;
  onUpdate: (json: JSONContent) => void;
  onSave?: () => void;
  onInsertMwsTable?: () => void;
  onInsertAiBlock?: () => void;
  onEditorReady?: (editor: TiptapEditor | null) => void;
  onRequestLinkEdit?: () => void;
  collab?: EditorCollab | null;
  collabUser?: { name: string; color: string };
}

export default function Editor({
  content,
  onUpdate,
  onSave,
  onInsertMwsTable,
  onInsertAiBlock,
  onEditorReady,
  onRequestLinkEdit,
  collab,
  collabUser,
}: EditorProps) {
  const navigate = useNavigate();
  const contentRef = useRef(content);
  contentRef.current = content;

  const [showSlash, setShowSlash] = useState(false);
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0 });
  const [showBubble, setShowBubble] = useState(false);
  const [tablePicker, setTablePicker] = useState<{ x: number; y: number } | null>(null);
  const [gridHover, setGridHover] = useState({ rows: 1, cols: 1 });
  const [tableCtx, setTableCtx] = useState<{ x: number; y: number } | null>(null);
  const [tableMenuBtn, setTableMenuBtn] = useState<{ x: number; y: number } | null>(null);

  const useCollab = Boolean(collab?.ydoc && collab?.provider && collabUser);
  const collabUserName = collabUser?.name;
  const collabUserColor = collabUser?.color;

  const handleWikiNavigate = useCallback(
    async (title: string) => {
      try {
        const results = await api.searchPages(title);
        if (results.length > 0 && results[0]) {
          navigate(`/page/${results[0].id}`);
        } else {
          // Page doesn't exist — navigate to new page with pre-filled title
          navigate(`/new?title=${encodeURIComponent(title)}`);
        }
      } catch {
        navigate(`/new?title=${encodeURIComponent(title)}`);
      }
    },
    [navigate]
  );

  const extensions = useMemo(() => {
    const starter = useCollab
      ? StarterKit.configure({ history: false })
      : StarterKit.configure({ history: { depth: 50 } });
    const link = Link.configure({
      openOnClick: false,
      protocols: ['http', 'https', 'mailto', 'ftp'],
      autolink: false,
      HTMLAttributes: {
        class: 'tiptap-link',
        rel: 'noopener noreferrer',
        target: undefined,
      },
    });
    const table = Table.configure({
      resizable: true,
      HTMLAttributes: { class: 'tiptap-data-table' },
    });
    const collabExts =
      useCollab && collab && collabUser
        ? [
            Collaboration.configure({ document: collab.ydoc }),
            CollaborationCursor.configure({
              provider: collab.provider,
              user: { name: collabUserName!, color: collabUserColor! },
            }),
          ]
        : [];
    return [
      starter,
      Underline,
      link,
      table,
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({
        placeholder: 'Начните писать или нажмите / для меню блоков...',
      }),
      MwsTableExtension,
      WikiLink.configure({
        onNavigate: handleWikiNavigate,
        HTMLAttributes: {},
      }),
      ...collabExts,
    ];
  }, [useCollab, collab, collabUserName, collabUserColor, handleWikiNavigate]);

  const editor = useEditor({
    extensions,
    content: useCollab ? { type: 'doc', content: [{ type: 'paragraph' }] } : content || undefined,
    onUpdate: ({ editor }) => {
      onUpdate(editor.getJSON());
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (editor.isActive('table')) {
        const $pos = editor.state.selection.$anchor;
        let found = false;
        for (let d = $pos.depth; d > 0; d--) {
          const name = $pos.node(d).type.name;
          if (name === 'table') {
            const start = editor.view.coordsAtPos($pos.before(d));
            setTableMenuBtn({ x: start.left, y: start.top - 28 });
            found = true;
            break;
          }
        }
        if (!found) setTableMenuBtn(null);
      } else {
        setTableMenuBtn(null);
      }
      if (from === to) {
        setShowBubble(false);
        return;
      }
      const start = editor.view.coordsAtPos(from);
      const end = editor.view.coordsAtPos(to);
      setBubblePos({
        x: Math.round((start.left + end.right) / 2),
        y: start.top - 12,
      });
      setShowBubble(true);
    },
    editorProps: {
      handleDOMEvents: {
        contextmenu: (_view, event) => {
          if (!editor) return false;
          const el = (event.target as HTMLElement).closest('td, th');
          if (!el || !editor.view.dom.contains(el)) return false;
          if (!editor.isActive('table')) return false;
          event.preventDefault();
          setTableCtx({ x: event.clientX, y: event.clientY });
          return true;
        },
      },
      handleClick: (_view, pos, event) => {
        if (!editor) return false;
        const el = event.target as HTMLElement;
        const a = el.closest('a');
        if (!a || !editor.view.dom.contains(a)) return false;
        event.preventDefault();
        editor.chain().focus().setTextSelection(pos).extendMarkRange('link').run();
        setTimeout(() => onRequestLinkEdit?.(), 0);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if (!editor) return false;
        if (showSlash) {
          // Navigation handled by SlashMenu's own input — just block Enter/Esc from going to editor
          if (event.key === 'Enter' || event.key === 'Escape' ||
              event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            return true; // swallow — SlashMenu handles these
          }
        }

        if (tablePicker && event.key === 'Escape') {
          setTablePicker(null);
          return true;
        }

        if (event.key === '/') {
          const coords = editor.view.coordsAtPos(editor.state.selection.from);
          setSlashPos({ x: coords.left, y: coords.bottom + 8 });
          setSelectedIndex(0);
          setShowSlash(true);
          return false;
        }
        if (showBubble && event.key === 'Escape') {
          setShowBubble(false);
          return false;
        }

        if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onSave?.();
          return true;
        }
        if (event.key === 'u' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          editor.chain().focus().toggleUnderline().run();
          return true;
        }
        return false;
      },
    },
  }, [extensions]);

  const runSlashAction = useCallback(
    (item: SlashItem) => {
      if (!editor) return;
      if (item.id === 'simpleTable') {
        setShowSlash(false);
        setGridHover({ rows: 2, cols: 2 });
        setTablePicker({ x: slashPos.x, y: slashPos.y });
        return;
      }
      if (item.id === 'mwsTable') {
        setShowSlash(false);
        onInsertMwsTable?.();
        return;
      }

      switch (item.id) {
        case 'h1':
          editor.chain().focus().toggleHeading({ level: 1 }).run();
          break;
        case 'h2':
          editor.chain().focus().toggleHeading({ level: 2 }).run();
          break;
        case 'h3':
          editor.chain().focus().toggleHeading({ level: 3 }).run();
          break;
        case 'bullet':
          editor.chain().focus().toggleBulletList().run();
          break;
        case 'ordered':
          editor.chain().focus().toggleOrderedList().run();
          break;
        case 'quote':
          editor.chain().focus().toggleBlockquote().run();
          break;
        case 'code':
          editor.chain().focus().toggleCodeBlock().run();
          break;
        case 'divider':
          editor.chain().focus().setHorizontalRule().run();
          break;
        case 'ai':
          onInsertAiBlock?.();
          break;
        default:
          break;
      }
      setShowSlash(false);
    },
    [editor, onInsertMwsTable, onInsertAiBlock, slashPos.x, slashPos.y]
  );

  const insertGridTable = (rows: number, cols: number) => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    setTablePicker(null);
  };

  const runTableMenu = (action: string) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    switch (action) {
      case 'addRowAfter':
        chain.addRowAfter().run();
        break;
      case 'addRowBefore':
        chain.addRowBefore().run();
        break;
      case 'addColAfter':
        chain.addColumnAfter().run();
        break;
      case 'addColBefore':
        chain.addColumnBefore().run();
        break;
      case 'delRow':
        chain.deleteRow().run();
        break;
      case 'delCol':
        chain.deleteColumn().run();
        break;
      case 'delTable':
        chain.deleteTable().run();
        break;
      default:
        break;
    }
    setTableCtx(null);
  };

  useEffect(() => {
    if (!useCollab || !collab || !editor) return;
    let done = false;
    const { provider, ydoc } = collab;
    const trySeed = () => {
      if (done) return;
      if (!provider.synced) return;
      const frag = ydoc.getXmlFragment('default');
      const initial = contentRef.current;
      if (frag.length === 0 && initial) {
        editor.commands.setContent(initial, false);
        done = true;
      }
    };
    const iv = window.setInterval(trySeed, 50);
    const to = window.setTimeout(() => window.clearInterval(iv), 8000);
    trySeed();
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(to);
    };
  }, [useCollab, collab, editor]);

  useEffect(() => {
    if (!editor || !useCollab || !collabUser) return;
    editor.commands.updateUser({ name: collabUser.name, color: collabUser.color });
  }, [editor, useCollab, collabUser]);

  useEffect(() => {
    onEditorReady?.(editor || null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!tablePicker && !tableCtx) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (
        el.closest?.('.table-size-picker') ||
        el.closest?.('.table-ctx-menu') ||
        el.closest?.('.table-toolbar-floating')
      ) {
        return;
      }
      setTablePicker(null);
      setTableCtx(null);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [tablePicker, tableCtx]);

  if (!editor) return null;

  return (
    <div className="tiptap-wrapper">
      {tableMenuBtn && editor.isActive('table') && !tableCtx && (
        <button
          type="button"
          className="table-toolbar-floating"
          style={{ left: tableMenuBtn.x, top: tableMenuBtn.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setTableCtx({ x: tableMenuBtn.x, y: tableMenuBtn.y + 28 });
          }}
        >
          Таблица ▾
        </button>
      )}
      {showBubble && (
        <div className="selection-bubble" style={{ left: bubblePos.x, top: bubblePos.y }}>
          <button
            className="bubble-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            className="bubble-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            className="bubble-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            U
          </button>
          <button
            className="bubble-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().toggleCode().run()}
          >
            {'</>'}
          </button>
          <button
            className="bubble-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRequestLinkEdit?.()}
            title="Ссылка"
          >
            @
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
      {showSlash && (
        <SlashMenu
          x={slashPos.x}
          y={slashPos.y}
          selectedIndex={selectedIndex}
          onSelect={(item) => {
            consumeSlashBeforeCursor(editor);
            runSlashAction(item);
          }}
          onClose={() => setShowSlash(false)}
          onIndexChange={setSelectedIndex}
        />
      )}
      {tablePicker && (
        <div
          className="table-size-picker"
          style={{ left: tablePicker.x, top: tablePicker.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="table-size-picker-grid">
            {Array.from({ length: TABLE_GRID_MAX }, (_, ri) => (
              <div key={ri} className="table-size-row">
                {Array.from({ length: TABLE_GRID_MAX }, (_, ci) => {
                  const r = ri + 1;
                  const c = ci + 1;
                  const active = r <= gridHover.rows && c <= gridHover.cols;
                  return (
                    <div
                      key={`${r}-${c}`}
                      className={`table-size-cell${active ? ' active' : ''}`}
                      onMouseEnter={() => setGridHover({ rows: r, cols: c })}
                      onClick={() => insertGridTable(r, c)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="table-size-label">
            {gridHover.cols} × {gridHover.rows}
          </div>
        </div>
      )}
      {tableCtx && (
        <div
          className="table-ctx-menu"
          style={{ left: tableCtx.x, top: tableCtx.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={() => runTableMenu('addRowBefore')}>
            Добавить строку выше
          </button>
          <button type="button" onClick={() => runTableMenu('addRowAfter')}>
            Добавить строку ниже
          </button>
          <button type="button" onClick={() => runTableMenu('addColBefore')}>
            Добавить столбец слева
          </button>
          <button type="button" onClick={() => runTableMenu('addColAfter')}>
            Добавить столбец справа
          </button>
          <button type="button" onClick={() => runTableMenu('delRow')}>
            Удалить строку
          </button>
          <button type="button" onClick={() => runTableMenu('delCol')}>
            Удалить столбец
          </button>
          <button type="button" className="danger" onClick={() => runTableMenu('delTable')}>
            Удалить таблицу
          </button>
        </div>
      )}
    </div>
  );
}
