import {
  NEW_PAGE_TITLE,
  PAGE_BLOCKS,
  applyPageBlock,
  filterPageBlocks,
  joinPageFill,
  pageLinkMarkdown,
  pageSlashQuery,
  type ID,
  type PageBlock,
} from '@branch/core';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Annotation, EditorState, Prec, StateEffect, StateField, Transaction } from '@codemirror/state';
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
  Sparkles,
  Square,
  SquareCode,
  Table,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { actions } from '../app/store';
import { cn } from '../lib/cn';
import { livePreview } from './livePreview';

const MENU_H = 320;
const CTX_W = 240;
const CTX_H = 420;

/** AI가 고치는 동안 잠금 (ADR-076) */
const setLock = StateEffect.define<boolean>();
const lockField = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setLock) ? e.value : acc), v),
  provide: (f) => EditorState.readOnly.from(f),
});
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
  '마크다운으로 자유롭게 적어 보세요. / 를 누르거나 우클릭하면 블록·하위 페이지·AI 채우기를 넣어요.\n\n# 제목\n- 목록\n**굵게**, `코드`\n\n다 쓰면 완료를 누르고, 글을 골라 물어보거나 표시할 수 있어요.';

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
  /** AI가 본문을 고치는 중 — 손으로 고치지 못하게 막는다 */
  locked?: boolean;
  /** AI로 채우는 중 */
  filling?: boolean;
  /** 커서 자리(before|after)에 AI로 채울 글. 받는 동안 onDelta, 끝나면 최종 글(멈췄거나 실패면 null) */
  onFill?: (input: { before: string; after: string; request?: string }, onDelta: (text: string) => void) => Promise<string | null>;
  onStopFill?: () => void;
}

/** 우클릭 메뉴 — pos는 넣을 자리 */
interface Ctx {
  pos: number;
  left: number;
  top: number;
  ask: boolean;
}

/**
 * 페이지 편집기 (ADR-075). CodeMirror 위에 실시간 미리보기를 얹어, 커서가 없는 곳은 렌더된 모습으로
 * 보이고 원문은 그대로 저장된다. `/`로 블록이나 하위 페이지 링크를 넣는다 (ADR-073).
 */
export function PageEditor({
  sessionId,
  initial,
  content,
  hasPending,
  onChange,
  onBlur,
  onFinish,
  locked = false,
  filling = false,
  onFill,
  onStopFill,
}: PageEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [ask, setAsk] = useState('');
  const [slash, setSlash] = useState<Slash | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** Esc로 닫은 `/` 위치 — 그 자리에선 다시 열지 않는다 */
  const closedAt = useRef<number | null>(null);
  const items = useMemo(() => (slash ? filterPageBlocks(slash.query) : []), [slash]);
  const slashOpen = items.length > 0;

  // CodeMirror 확장은 한 번 만들고, 최신 콜백·상태는 ref로 읽는다
  const latest = useRef({ onChange, onBlur, onFinish, slash, slashOpen, items, slashIndex, locked });
  latest.current = { onChange, onBlur, onFinish, slash, slashOpen, items, slashIndex, locked };

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

  const pickBlock = (block: PageBlock, at?: number) => {
    const v = view.current;
    const s = latest.current.slash;
    if (!v || (!s && at === undefined)) return;
    const start = at ?? s!.start;
    const caret = at ?? v.state.selection.main.head;
    let b = block;
    if (block.id === 'page') {
      // 하위 페이지를 만들고 그 링크를 넣는다. 지금 페이지에 머문다
      const id = actions().newPage(undefined, { parentId: sessionId, focus: false });
      if (!id) return;
      b = { ...block, text: pageLinkMarkdown(NEW_PAGE_TITLE, id) };
    }
    const before = v.state.doc.toString();
    const r = applyPageBlock(before, start, caret, b);
    setSlash(null);
    setCtx(null);
    v.dispatch({
      changes: minimalChange(before, r.text),
      selection: { anchor: r.selStart, head: r.selEnd },
      scrollIntoView: true,
    });
    v.focus();
  };
  const pickRef = useRef(pickBlock);
  pickRef.current = pickBlock;

  /** 누른 자리에 커서를 두고(고른 글 위면 그 끝) 그 옆에 메뉴를 연다 */
  const openCtx = (e: MouseEvent, v: EditorView) => {
    if (latest.current.locked) return;
    const sel = v.state.selection.main;
    const hit = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? sel.head;
    const pos = !sel.empty && hit >= sel.from && hit <= sel.to ? sel.to : hit;
    v.dispatch({ selection: { anchor: pos } });
    v.focus();
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    // 화면 밖으로 넘치지 않게 왼쪽·위로 당긴다
    const vv = window.visualViewport;
    const vw = vv ? vv.offsetLeft + vv.width : window.innerWidth;
    const vh = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const x = Math.max(8, Math.min(e.clientX, vw - CTX_W - 8));
    const y = Math.max(8, Math.min(e.clientY, vh - CTX_H - 8));
    setSlash(null);
    setAsk('');
    setCtx({ pos, left: x - box.left, top: y - box.top, ask: false });
  };
  const ctxRef = useRef(openCtx);
  ctxRef.current = openCtx;

  /** 커서 자리에 AI 글을 흘려 넣고, 끝나면 되돌리기 한 번에 지워지도록 한 덩어리로 다시 넣는다 */
  const fillAt = async (pos: number, request: string) => {
    const v = view.current;
    if (!v || !onFill) return;
    setCtx(null);
    pos = Math.min(pos, v.state.doc.length);
    const text = v.state.doc.toString();
    const before = text.slice(0, pos);
    const after = text.slice(pos);
    let len = 0;
    const put = (insert: string, record: boolean) => {
      const cur = view.current;
      if (!cur) return;
      cur.dispatch({
        changes: { from: pos, to: pos + len, insert },
        selection: { anchor: pos + insert.length },
        scrollIntoView: true,
        ...(record ? { userEvent: 'input.ai' } : { annotations: Transaction.addToHistory.of(false) }),
      });
      len = insert.length;
    };
    const final = await onFill({ before, after, request }, (t) => put(joinPageFill(before, t, after), false));
    if (!view.current) return;
    put('', false);
    if (final) put(joinPageFill(before, final, after), true);
    view.current.focus();
  };

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
          lockField,
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
            // 우클릭은 블록·AI 채우기 메뉴. Shift+우클릭은 기본 메뉴(복사·붙여넣기)
            contextmenu: (e, ed) => {
              if (e.shiftKey) return false;
              e.preventDefault();
              ctxRef.current(e, ed);
              return true;
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

  // AI가 고치는 동안은 읽기 전용
  useEffect(() => {
    const v = view.current;
    // 설정을 갈아 끼우지 않고 값만 바꾼다 — reconfigure는 실시간 렌더의 포커스 상태를 흐트러뜨린다
    if (v && v.state.field(lockField) !== locked) v.dispatch({ effects: setLock.of(locked) });
    if (locked) setCtx(null);
  }, [locked]);

  // 메뉴 밖을 누르거나 스크롤하면 닫는다
  const ctxMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ctx) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && ctxMenu.current?.contains(e.target)) return;
      setCtx(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [ctx]);
  // 메뉴가 열리면 첫 항목에 포커스 — 방향키로 고른다
  useEffect(() => {
    if (!ctx) return;
    const el = ctxMenu.current?.querySelector<HTMLElement>(ctx.ask ? 'input' : '[role="menuitem"]');
    el?.focus();
  }, [ctx]);

  const closeCtx = () => {
    setCtx(null);
    view.current?.focus();
  };
  const onCtxKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (ctx?.ask) setCtx({ ...ctx, ask: false });
      else closeCtx();
      return;
    }
    if (ctx?.ask || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    const list = [...(ctxMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    const n = list.length;
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
  };

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
      {filling && (
        <div className="sticky bottom-3 z-20 mt-3 flex justify-center">
          <button
            type="button"
            data-page-fill-stop=""
            onMouseDown={(e) => e.preventDefault()}
            onClick={onStopFill}
            className="flex items-center gap-2 rounded-full border border-line bg-elev px-3.5 py-1.5 text-[13px] text-fg-2 shadow-float hover:bg-surface-2"
          >
            <Sparkles size={14} className="animate-pulse text-accent" />
            AI가 채우는 중
            <Square size={12} className="text-muted" />
          </button>
        </div>
      )}
      {ctx && (
        <div
          ref={ctxMenu}
          data-page-context=""
          role="menu"
          aria-label="블록·AI 메뉴"
          onKeyDown={onCtxKey}
          onContextMenu={(e) => e.preventDefault()}
          style={{ left: ctx.left, top: ctx.top, width: CTX_W }}
          className="animate-pop-in absolute z-30 flex flex-col rounded-xl border border-line bg-elev p-1 shadow-float"
        >
          {ctx.ask ? (
            <form
              className="flex flex-col gap-1.5 p-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void fillAt(ctx.pos, ask);
              }}
            >
              <label htmlFor={`page-fill-${sessionId}`} className="text-[12px] font-medium text-muted">
                무엇을 채울까요? (비우면 앞뒤 맥락대로)
              </label>
              <input
                id={`page-fill-${sessionId}`}
                value={ask}
                onChange={(e) => setAsk(e.target.value)}
                placeholder="예: 장단점을 표로"
                className="h-8 rounded-lg border border-line bg-surface px-2.5 text-[13.5px] text-fg outline-none focus:border-accent"
              />
              <button type="submit" className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-accent text-[13px] font-medium text-accent-fg hover:brightness-110">
                <Sparkles size={14} />
                채우기
              </button>
            </form>
          ) : (
            <>
              {onFill && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-page-ai-fill=""
                    onClick={() => setCtx({ ...ctx, ask: true })}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-fg outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
                      <Sparkles size={15} />
                    </span>
                    AI로 내용 채우기
                  </button>
                  <div className="my-1 h-px bg-line" />
                </>
              )}
              <div className="px-2.5 pt-0.5 pb-1 text-[11.5px] font-medium text-muted">블록 넣기</div>
              <div className="scroll-thin overflow-y-auto" style={{ maxHeight: CTX_H - 90 }}>
                {PAGE_BLOCKS.map((b) => {
                  const Icon = BLOCK_ICONS[b.id] ?? FileText;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      role="menuitem"
                      data-context-block={b.id}
                      onClick={() => pickBlock(b, ctx.pos)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left outline-none hover:bg-surface-2 focus-visible:bg-surface-2"
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-surface text-fg-2">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{b.label}</span>
                      <code className="shrink-0 text-[11.5px] text-muted">{b.hint}</code>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
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
