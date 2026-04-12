import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * WikiLink — inline mark for [[Page Name]] syntax.
 * Renders as a styled link. Clicking navigates to the page by title.
 */
export interface WikiLinkOptions {
  /** Called when user clicks a wiki link — receives the page title */
  onNavigate?: (title: string) => void;
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { title: string }) => ReturnType;
      unsetWikiLink: () => ReturnType;
    };
  }
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: 'wikiLink',

  addOptions() {
    return {
      onNavigate: undefined,
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-wiki-title'),
        renderHTML: (attrs) =>
          attrs.title ? { 'data-wiki-title': attrs.title } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-wiki-title]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        class: 'wiki-link',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetWikiLink:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },

  addProseMirrorPlugins() {
    const navigate = this.options.onNavigate;

    return [
      // Auto-detect [[...]] patterns and apply the wikiLink mark
      new Plugin({
        key: new PluginKey('wikiLinkInput'),
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== ']') return false;
            const { state } = view;
            const { doc } = state;
            // Look back up to 200 chars for [[ ... ]]
            const start = Math.max(0, from - 200);
            const before = doc.textBetween(start, from, '') + text;
            // Match [[Page Name]] — find closing ]]
            const matchClose = before.match(/\[\[([^\]]+)\]\]?$/);
            if (!matchClose) return false;
            // Check if we're adding the second ]
            const partial = before.slice(0, -1);
            if (!partial.endsWith(']')) return false;
            const match = partial.match(/\[\[([^\]]+)\]$/);
            if (!match) return false;

            const pageTitle = match[1] ?? '';
            if (!pageTitle.trim()) return false;

            const fullMatch = `[[${pageTitle}]]`;
            const insertFrom = from - fullMatch.length + 1; // +1 because `text` not yet inserted

            const tr = state.tr;
            tr.replaceWith(insertFrom, to, state.schema.text(fullMatch));

            // Apply wikiLink mark over the inserted text
            const markType = state.schema.marks['wikiLink'];
            if (markType) {
              tr.addMark(
                insertFrom,
                insertFrom + fullMatch.length,
                markType.create({ title: pageTitle })
              );
            }
            view.dispatch(tr);
            return true;
          },
          // Click handling — navigate on click
          handleClick(view, pos, event) {
            const { state } = view;
            const { doc } = state;
            const $pos = doc.resolve(pos);
            const marks = $pos.marks();
            const wikiMark = marks.find((m) => m.type.name === 'wikiLink');
            if (!wikiMark) return false;
            const title = wikiMark.attrs.title as string;
            if (title && navigate) {
              event.preventDefault();
              navigate(title);
              return true;
            }
            return false;
          },
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];
            // Highlight unresolved [[...]] text patterns that haven't been converted yet
            doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const text = node.text;
              let match: RegExpExecArray | null;
              const re = /\[\[([^\]]+)\]\]/g;
              while ((match = re.exec(text)) !== null) {
                const hasWikiMark = node.marks.some((m) => m.type.name === 'wikiLink');
                if (!hasWikiMark) {
                  decorations.push(
                    Decoration.inline(pos + match.index, pos + match.index + match[0].length, {
                      class: 'wiki-link-raw',
                    })
                  );
                }
              }
            });
            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
