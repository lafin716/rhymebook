import { NEW_PAGE_TITLE, applyPageBlock, filterPageBlocks, pageLinkMarkdown, pageSlashQuery, type ID, type PageBlock } from '@branch/core';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import {
  FileText,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  SquareCode,
  Table,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { actions } from '../app/store';
import { cn } from '../lib/cn';
import { livePreview } from './livePreview';

const MENU_H = 320;
/** 바깥에서 들어온 본문 — 다시 저장하지 않는다 */
const external = Annotation.define<boolean>();

const BLOCK_ICONS: Record<string, LucideIcon> = {
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullet: List,
  number: ListOrdered,
  todo: ListTodo,
  quote: Quote,
  code: SquareCode,
  divider: Minus,
  table: Table,
  math: Sigma,
  page: FileText,
};

const EMPTY_ITEM = /^(\s*)(?:[-*+]|\d+[.)]) (?:\[[ xX]\] ?)?\s*$/;

/** 노션처럼 빈 목록·할 일 항목에서 Enter는 목록을 끝낸다 (기본은 느슨한 목록으로 이어 간다) */
function exitEmptyItem(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (!sel.empty || view.composing) return false;
  const line = state.doc.lineAt(sel.head);
  const m = EMPTY_ITEM.exec(line.text);
  if (!m || sel.head !== line.to) return false;
  const indent = m[1] ?? '';
  view.dispatch({ changes: { from: line.from, to: line.to, insert: indent }, selection: { anchor: line.from + indent.length }, userEvent: 'delete' });
  return true;
}

const PLACEHOLDER =
  '마크다운으로 자유롭게 적어 보세요. / 를 누르면 블록·하위 페이지를 넣어요.\n\n# 제목\n- 목록\n**굵게**, `코드`\n\n다 쓰면 완료를 누르고, 글을 골라 물어보거나 표시할 수 있어요.';

/** 바뀐 가운데만 고쳐 커서·되돌리기 기록을 지킨다 */
function minimalChange(before: string, after: string) {
  let head = 0;
  const max = Math.min(before.length, after.length);
  while (head < max && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < max - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return { from: head, to: before.length - tail, insert: after.slice(head, after.length - tail) };
}

/** `/` 블록 메뉴 상태 — start는 `/` 위치 */
interface Slash {
  start: number;
  query: string;
  left: number;
  top: number;
  up: boolean;
}

export interface PageEditorProps {
  sessionId: ID;
  initial: string;
  /** 저장된 본문 — 저장 안 한 글이 없을 때 바깥(원격·하위 페이지 이름 바꾸기) 변경을 따른다 */
  content: string;
  hasPending: () => boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
  /** Esc·⌘Enter — 편집을 마친다 */
  onFinish: () => void;
}

/**
 * 페이지 편집기 (ADR-075). CodeMirror 위에 실시간 미리보기를 얹어, 커서가 없는 곳은 렌더된 모습으로
 * 보이고 원문은 그대로 저장된다. `/`로 블록이나 하위 페이지 링크를 넣는다 (ADR-073).
 */
export function PageEditor({ sessionId, initial, content, hasPending, onChange, onBlur, onFinish }: PageEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** Esc로 닫은 `/` 위치 — 그 자리에선 다시 열지 않는다 */
  const closedAt = useRef<number | null>(null);
  const items = useMemo(() => (slash ? filterPageBlocks(slash.query) : []), [slash]);
  const slashOpen = items.length > 0;

  // CodeMirror 확장은 한 번 만들고, 최신 콜백·상태는 ref로 읽는다
  const latest = useRef({ onChange, onBlur, onFinish, slash, slashOpen, items, slashIndex });
  latest.current = { onChange, onBlur, onFinish, slash, slashOpen, items, slashIndex };

  /** 커서 앞이 `/검색어`면 그 아래(공간이 없으면 위)에 블록 메뉴를 연다 */
  const syncSlash = (v: EditorView) => {
    const sel = v.state.selection.main;
    if (!sel.empty || !v.hasFocus) return setSlash(null);
    const q = pageSlashQuery(v.state.doc.toString(), sel.head);
    if (!q || closedAt.current === q.start) {
      if (!q) closedAt.current = null;
      return setSlash(null);
    }
    const c = v.coordsAtPos(q.start);
    const box = host.current?.getBoundingClientRect();
    if (!c || !box) return setSlash(null);
    // 스크롤 영역과 (모바일 키보드가 줄인) 보이는 화면 안에서 아래 공간이 모자라면 위로 연다
    const scroll = host.current?.closest('[data-scroll]')?.getBoundingClientRect();
    const vv = window.visualViewport;
    const bottom = Math.min(scroll?.bottom ?? Infinity, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const up = c.bottom + MENU_H > bottom && c.top - MENU_H > (scroll?.top ?? 0);
    setSlash({
      start: q.start,
      query: q.query,
      left: Math.min(c.left - box.left, Math.max(0, box.width - 256)),
      top: (up ? c.top : c.bottom) - box.top,
      up,
    });
  };
  const syncRef = useRef(syncSlash);
  syncRef.current = syncSlash;

  const pickBlock = (block: PageBlock) => {
    const v = view.current;
    const s = latest.current.slash;
    if (!v || !s) return;
    let b = block;
    if (block.id === 'page') {
      // 하위 페이지를 만들고 그 링크를 넣는다. 지금 페이지에 머문다
      const id = actions().newPage(undefined, { parentId: sessionId, focus: false });
      if (!id) return;
      b = { ...block, text: pageLinkMarkdown(NEW_PAGE_TITLE, id) };
    }
    const before = v.state.doc.toString();
    const r = applyPageBlock(before, s.start, v.state.selection.main.head, b);
    setSlash(null);
    v.dispatch({
      changes: minimalChange(before, r.text),
      selection: { anchor: r.selStart, head: r.selEnd },
      scrollIntoView: true,
    });
    v.focus();
  };
  const pickRef = useRef(pickBlock);
  pickRef.current = pickBlock;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const placeholderEl = document.createElement('span');
    placeholderEl.style.whiteSpace = 'pre-wrap';
    placeholderEl.textContent = PLACEHOLDER;
    const v = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial,
        extensions: [
          Prec.highest(
            keymap.of([
              { key: 'ArrowDown', run: () => moveSlash(1) },
              { key: 'ArrowUp', run: () => moveSlash(-1) },
              { key: 'Enter', run: () => pickCurrent() },
              { key: 'Enter', run: exitEmptyItem },
              { key: 'Tab', run: () => pickCurrent() },
              {
                key: 'Escape',
                run: (ed) => {
                  const l = latest.current;
                  if (l.slashOpen && l.slash) {
                    // 메뉴만 닫고 편집은 이어간다
                    closedAt.current = l.slash.start;
                    setSlash(null);
                    return true;
                  }
                  if (ed.composing) return false;
                  l.onFinish();
                  return true;
                },
              },
              {
                key: 'Mod-Enter',
                run: () => {
                  latest.current.onFinish();
                  return true;
                },
              },
            ]),
          ),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          markdown({ base: markdownLanguage }),
          EditorView.lineWrapping,
          placeholder(placeholderEl),
          EditorView.contentAttributes.of({ 'aria-label': '페이지 본문 (마크다운)', spellcheck: 'false', 'aria-multiline': 'true' }),
          livePreview({
            openPage: (id) => actions().openSession(id, 'main'),
            pageExists: (id) => !!actions().sessions[id],
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) latest.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet || u.focusChanged) syncRef.current(u.view);
          }),
          EditorView.domEventHandlers({
            blur: () => {
              setSlash(null);
              latest.current.onBlur();
            },
          }),
        ],
      }),
    });
    view.current = v;
    v.focus();
    const end = v.state.doc.length;
    v.dispatch({ selection: { anchor: end } });
    return () => {
      v.destroy();
      view.current = null;
    };
    // 세션마다 새 편집기 (PagePanel이 key로 다시 만든다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveSlash(d: 1 | -1) {
    const l = latest.current;
    if (!l.slashOpen || view.current?.composing) return false;
    const n = l.items.length;
    setSlashIndex((i) => (i + d + n) % n);
    return true;
  }
  function pickCurrent() {
    const l = latest.current;
    // 한글 조합 중 Enter는 조합만 끝낸다
    if (!l.slashOpen || view.current?.composing) return false;
    pickRef.current(l.items[l.slashIndex] ?? l.items[0]!);
    return true;
  }

  useEffect(() => {
    const v = view.current;
    if (!v || hasPending()) return;
    const before = v.state.doc.toString();
    if (before !== content) v.dispatch({ changes: minimalChange(before, content), annotations: [external.of(true), Transaction.addToHistory.of(false)] });
  }, [content, hasPending]);

  useEffect(() => setSlashIndex(0), [slash?.start, slash?.query]);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, slashOpen]);

  // 목록 버튼이 화면 낭독기와 이어지도록 편집 영역에 메뉴 관계를 단다
  useEffect(() => {
    const el = view.current?.contentDOM;
    if (!el) return;
    if (slashOpen) {
      el.setAttribute('aria-controls', `page-blocks-${sessionId}`);
      el.setAttribute('aria-activedescendant', `page-block-${sessionId}-${slashIndex}`);
    } else {
      el.removeAttribute('aria-controls');
      el.removeAttribute('aria-activedescendant');
    }
  }, [slashOpen, slashIndex, sessionId]);

  return (
    <div className="relative">
      <div ref={host} data-page-editor="" className="page-editor min-h-[50vh]" />
      {slashOpen && slash && (
        <div
          data-page-blocks=""
          // 메뉴를 눌러도 본문 포커스(커서)를 잃지 않게
          onMouseDown={(e) => e.preventDefault()}
          style={{ left: slash.left, top: slash.top }}
          className={cn(
            'animate-pop-in absolute z-20 flex w-64 max-w-full flex-col rounded-xl border border-line bg-elev p-1 shadow-float',
            slash.up ? '-mt-1 -translate-y-full' : 'mt-1',
          )}
        >
          <div id={`page-blocks-${sessionId}-label`} className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium text-muted">
            블록 넣기 · ↑↓ 선택 · Enter
          </div>
          <div
            id={`page-blocks-${sessionId}`}
            ref={menu}
            role="listbox"
            aria-label="블록 넣기"
            style={{ maxHeight: MENU_H - 40 }}
            className="scroll-thin overflow-y-auto"
          >
            {items.map((b, i) => {
              const Icon = BLOCK_ICONS[b.id] ?? FileText;
              return (
                <button
                  key={b.id}
                  id={`page-block-${sessionId}-${i}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === slashIndex}
                  data-block={b.id}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => pickBlock(b)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === slashIndex && 'bg-surface-2')}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md border border-line bg-surface text-fg-2">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">{b.label}</span>
                  <code className="shrink-0 text-[12px] text-muted">{b.hint}</code>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
