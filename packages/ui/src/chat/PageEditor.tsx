import {
  NEW_PAGE_TITLE,
  PAGE_BLOCKS,
  applyPageBlock,
  filterPageBlocks,
  joinPageFill,
  pageFileMarkdown,
  pageImageMarkdown,
  pageLinkMarkdown,
  pageSlashQuery,
  locateSourceAnchor,
  toggleInlineFormat,
  renumberOrderedLists,
  emojiMatches,
  unwrapColumns,
  moveMarkdownBlock,
  markdownBlocks,
  type EmojiMatch,
  type MarkdownBlock,
  type Annotation as TextAnnotation,
  type ID,
  type InlineFormat,
  type PageBlock,
  type Session,
} from '@branch/core';
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, undoDepth, redoDepth } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { Annotation, EditorState, Prec, StateEffect, StateField, Transaction, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view';
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Quote,
  Sigma,
  Sparkles,
  Square,
  SquareCode,
  Table,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { actions } from '../app/store';
import { pushNotice } from '../app/sync';
import { cn } from '../lib/cn';
import { annotationProps } from './anchorPlugin';
import { pageEmbed } from './attach';
import { livePreview } from './livePreview';
import { minimalChange } from './pageText';
import { openBranch } from './open';
import { PageBlockHandles } from './PageBlockHandles';
import { registerPageEditor } from './pageEditorBridge';
import { getEmojiQuery } from './pageEmoji';

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
  image: ImageIcon,
  file: Paperclip,
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
  '마크다운으로 자유롭게 적어 보세요. 쓰는 대로 저장돼요. / 를 누르거나 우클릭하면 블록·하위 페이지·AI 채우기를 넣어요.\n\n# 제목\n- 목록\n**굵게**, `코드`\n\n글을 고르면 물어보거나 서식·메모를 넣을 수 있어요.';

/** 본문 위에 그릴 가지·서식 표시 (ADR-086) */
interface Marks {
  branches: { id: ID; anchor: NonNullable<Session['anchor']>; hasSummary: boolean }[];
  annotations: TextAnnotation[];
}
const setMarks = StateEffect.define<Marks>();
const marksField = StateField.define<Marks>({
  create: () => ({ branches: [], annotations: [] }),
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(setMarks) ? e.value : acc), v),
});

/** 가지 끝 아이콘 — 누르면 가지를 연다 */
class BranchWidget extends WidgetType {
  constructor(readonly id: ID) {
    super();
  }
  eq(other: BranchWidget) {
    return other.id === this.id;
  }
  toDOM() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-anchor-open';
    b.dataset.branchOpen = this.id;
    b.setAttribute('aria-label', '가지 열기');
    b.title = '가지 열기';
    b.contentEditable = 'false';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      openBranch(this.id);
    });
    return b;
  }
}

/** 메모 끝 아이콘 — 누르면 메모를 보여 준다 */
class NoteWidget extends WidgetType {
  constructor(
    readonly annotation: TextAnnotation,
    readonly open: (a: TextAnnotation, rect: DOMRect) => void,
  ) {
    super();
  }
  eq(other: NoteWidget) {
    return other.annotation === this.annotation;
  }
  toDOM() {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-note-open';
    b.dataset.noteOpen = this.annotation.id;
    b.setAttribute('aria-label', '메모 보기');
    b.title = '메모 보기';
    b.contentEditable = 'false';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      this.open(this.annotation, b.getBoundingClientRect());
    });
    return b;
  }
}

/** data-* 이름 (dataHl → data-hl) */
const dataAttr = (k: string) => (k === 'style' ? k : k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));

/** 가지·서식 범위를 원문에서 다시 찾아 그린다. 본문을 고치면 위치를 따라 옮기고, 표시가 바뀌면 새로 찾는다 */
function marksDecorations(openNote: (a: TextAnnotation, rect: DOMRect) => void) {
  const build = (state: EditorState): DecorationSet => {
    const { branches, annotations } = state.field(marksField);
    if (!branches.length && !annotations.length) return Decoration.none;
    const source = state.doc.toString();
    const out: Range<Decoration>[] = [];
    for (const b of branches) {
      const r = locateSourceAnchor(source, b.anchor);
      if (!r) continue;
      out.push(
        Decoration.mark({
          tagName: 'mark',
          class: 'anchor',
          attributes: { 'data-session-id': b.id, 'data-session-ids': b.id, 'data-has-summary': String(b.hasSummary) },
        }).range(r.start, r.end),
        Decoration.widget({ widget: new BranchWidget(b.id), side: 1 }).range(r.end),
      );
    }
    for (const a of annotations) {
      const r = locateSourceAnchor(source, a.anchor);
      if (!r) continue;
      const attributes: Record<string, string> = { 'data-annot-ids': a.id };
      for (const [k, v] of Object.entries(annotationProps([a]))) if (v) attributes[dataAttr(k)] = v;
      if (a.note) attributes['data-note'] = 'true';
      out.push(Decoration.mark({ class: 'annot', attributes }).range(r.start, r.end));
      if (a.note) out.push(Decoration.widget({ widget: new NoteWidget(a, openNote), side: 2 }).range(r.end));
    }
    return Decoration.set(out, true);
  };
  return StateField.define<DecorationSet>({
    create: build,
    update: (deco, tr) => (tr.effects.some((e) => e.is(setMarks)) ? build(tr.state) : tr.docChanged ? deco.map(tr.changes) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
}


/** `/` 블록 메뉴 상태 — start는 `/` 위치 */
interface Slash {
  start: number;
  query: string;
  left: number;
  top: number;
  up: boolean;
}

/** `:` 이모지 후보 상태 — start는 `:` 위치 (ADR-087) */
interface Emo extends Slash {
  matches: EmojiMatch[];
}
const EMO_H = 280;

export interface PageEditorProps {
  sessionId: ID;
  initial: string;
  /** 저장된 본문 — 저장 안 한 글이 없을 때 바깥(원격·하위 페이지 이름 바꾸기) 변경을 따른다 */
  content: string;
  hasPending: () => boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
  /** 페이지 문서 메시지 id — 있으면 고른 글로 가지·서식을 만들 수 있다 */
  messageId?: ID;
  /** 이 문서에 앵커를 둔 가지 — 본문에 표시하고 끝 아이콘으로 연다 */
  branches?: Session[];
  /** 이 문서의 서식·메모 */
  annotations?: TextAnnotation[];
  /** 메모 아이콘을 누름 */
  onNote?: (annotation: TextAnnotation, rect: DOMRect) => void;
  /** AI가 본문을 고치는 중 — 손으로 고치지 못하게 막는다 */
  locked?: boolean;
  /** AI로 채우는 중 */
  filling?: boolean;
  /** 커서 자리(before|after)에 AI로 채울 글. 받는 동안 onDelta, 끝나면 최종 글(멈췄거나 실패면 null) */
  onFill?: (input: { before: string; after: string; request?: string }, onDelta: (text: string) => void) => Promise<string | null>;
  onStopFill?: () => void;
  /** `:` 이모지 미리보기 켜기 (기본 true) */
  emoji?: boolean;
  /** 편집기 view 생성·제거 알림 (onView(view) 또는 onView(null)) */
  onView?: (view: EditorView | null) => void;
  /** 되돌리기 기록 상태 변경 알림 */
  onHistory?: (h: { undo: number; redo: number }) => void;
}

/** 우클릭 메뉴 — pos는 넣을 자리 */
interface Ctx {
  pos: number;
  left: number;
  top: number;
  ask: boolean;
  /** 핸들로 연 메뉴 — 그 블록 옮기기·지우기·나란히 풀기 */
  block?: { index: number; kind: MarkdownBlock['kind'] };
}

/**
 * 페이지 편집기 (ADR-075). CodeMirror 위에 실시간 미리보기를 얹어, 커서가 없는 곳은 렌더된 모습으로
 * 보이고 원문은 그대로 저장된다. `/`로 블록이나 하위 페이지 링크를 넣는다 (ADR-073).
 * 따로 보기 화면 없이 늘 고칠 수 있고, 가지·서식도 이 위에 그린다 (ADR-086).
 */
export function PageEditor({
  sessionId,
  initial,
  content,
  hasPending,
  onChange,
  onBlur,
  messageId,
  branches,
  annotations,
  onNote,
  locked = false,
  filling = false,
  onFill,
  onStopFill,
  emoji = true,
  onView,
  onHistory: _onHistory,
}: PageEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  /** 핸들이 쓰는 편집기와 다시 잴 때를 알리는 값 */
  const [editor, setEditor] = useState<EditorView | null>(null);
  const [layoutTick, setLayoutTick] = useState(0);
  const [ask, setAsk] = useState('');
  const [slash, setSlash] = useState<Slash | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  /** 이미지·파일 고르기 — 고른 파일을 넣을 자리 */
  const fileInput = useRef<HTMLInputElement>(null);
  const embedAt = useRef<{ pos: number; block: PageBlock } | null>(null);
  /** Esc로 닫은 `/` 위치 — 그 자리에선 다시 열지 않는다 */
  const closedAt = useRef<number | null>(null);
  const items = useMemo(() => (slash ? filterPageBlocks(slash.query) : []), [slash]);
  const slashOpen = items.length > 0;
  const [emo, setEmo] = useState<Emo | null>(null);
  const [emoIndex, setEmoIndex] = useState(0);
  const emoOpen = !!emo && emo.matches.length > 0;
  /** 터치 입력인지 판정 (P10) */
  const lastPointerType = useRef<string>('mouse');
  const isTouchInput = () => lastPointerType.current !== 'mouse';

  // CodeMirror 확장은 한 번 만들고, 최신 콜백·상태는 ref로 읽는다
  const latest = useRef({ onChange, onBlur, onNote, slash, slashOpen, items, slashIndex, locked, emoji, emo, emoOpen, emoIndex });
  latest.current = { onChange, onBlur, onNote, slash, slashOpen, items, slashIndex, locked, emoji, emo, emoOpen, emoIndex };

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
  /** 커서 앞이 `:검색어`면 이모지 후보를 연다 — 설정에서 끌 수 있다 */
  const syncEmoji = (v: EditorView) => {
    const sel = v.state.selection.main;
    if (!latest.current.emoji || !sel.empty || !v.hasFocus || v.composing) return setEmo(null);
    const q = getEmojiQuery(v.state.doc.toString(), sel.head);
    if (!q || !/^[\p{L}\p{N}_+-]{1,30}$/u.test(q.query) || emoClosedAt.current === q.start) {
      if (!q) emoClosedAt.current = null;
      return setEmo(null);
    }
    const matches = emojiMatches(q.query, 8);
    const c = v.coordsAtPos(q.start);
    const box = host.current?.getBoundingClientRect();
    if (!matches.length || !c || !box) return setEmo(null);
    const scroll = host.current?.closest('[data-scroll]')?.getBoundingClientRect();
    const vv = window.visualViewport;
    const bottom = Math.min(scroll?.bottom ?? Infinity, vv ? vv.offsetTop + vv.height : window.innerHeight);
    const up = c.bottom + EMO_H > bottom && c.top - EMO_H > (scroll?.top ?? 0);
    setEmo({
      start: q.start,
      query: q.query,
      matches,
      left: Math.min(c.left - box.left, Math.max(0, box.width - 256)),
      top: (up ? c.top : c.bottom) - box.top,
      up,
    });
  };
  const emoClosedAt = useRef<number | null>(null);
  const syncRef = useRef((v: EditorView) => {
    syncSlash(v);
    syncEmoji(v);
  });
  syncRef.current = (v: EditorView) => {
    syncSlash(v);
    syncEmoji(v);
  };

  /** 고른 이모지로 `:검색어`를 바꾼다 */
  const pickEmoji = (m: EmojiMatch) => {
    const v = view.current;
    const e = latest.current.emo;
    if (!v || !e) return;
    const caret = v.state.selection.main.head;
    setEmo(null);
    v.dispatch({ changes: { from: e.start, to: caret, insert: m.emoji }, selection: { anchor: e.start + m.emoji.length }, userEvent: 'input.emoji' });
    v.focus();
  };
  const pickEmojiRef = useRef(pickEmoji);
  pickEmojiRef.current = pickEmoji;

  const applyFormat = (kind: InlineFormat) => {
    const v = view.current;
    if (!v || latest.current.locked) return false;
    const sel = v.state.selection.main;
    const before = v.state.doc.toString();
    const r = toggleInlineFormat(before, sel.from, sel.to, kind);
    if (!r) return false;
    v.dispatch({ changes: minimalChange(before, r.text), selection: { anchor: r.selStart, head: r.selEnd }, userEvent: 'input.format' });
    v.focus();
    return true;
  };
  const formatRef = useRef(applyFormat);
  formatRef.current = applyFormat;

  /** 고른 이미지·파일을 본문에 data URL로 넣는다 */
  const insertEmbed = async (file: File) => {
    const target = embedAt.current;
    embedAt.current = null;
    if (!target || !view.current) return;
    const kind = target.block.id === 'image' ? 'image' : 'file';
    const got = await pageEmbed(file, kind);
    const cur = view.current;
    if (!cur) return;
    if (typeof got === 'string') {
      pushNotice(got);
      return;
    }
    const md = kind === 'image' ? pageImageMarkdown(got.name, got.url) : pageFileMarkdown(got.name, got.url);
    const before = cur.state.doc.toString();
    const pos = Math.min(target.pos, before.length);
    const r = applyPageBlock(before, pos, pos, { ...target.block, text: md });
    cur.dispatch({ changes: minimalChange(before, r.text), selection: { anchor: r.selStart }, scrollIntoView: true });
    cur.focus();
  };

  const pickBlock = (block: PageBlock, at?: number) => {
    const v = view.current;
    const s = latest.current.slash;
    if (!v || (!s && at === undefined)) return;
    const start = at ?? s!.start;
    const caret = at ?? v.state.selection.main.head;
    let b = block;
    if (block.id === 'image' || block.id === 'file') {
      // `/검색어`를 지우고 파일을 고르게 한다. 고르면 그 자리에 넣는다
      setSlash(null);
      setCtx(null);
      if (caret > start) v.dispatch({ changes: { from: start, to: caret }, selection: { anchor: start } });
      embedAt.current = { pos: start, block };
      const input = fileInput.current;
      if (input) {
        input.accept = block.id === 'image' ? 'image/png,image/jpeg,image/gif,image/webp' : '';
        input.value = '';
        input.click();
      }
      return;
    }
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
    showCtx({ pos, ask: false }, e.clientX, e.clientY);
  };
  /** 화면 좌표(x, y) 옆에 메뉴를 띄운다 — 화면 밖으로 넘치지 않게 왼쪽·위로 당긴다 */
  const showCtx = (c: Omit<Ctx, 'left' | 'top'>, cx: number, cy: number) => {
    const box = host.current?.getBoundingClientRect();
    if (!box) return;
    const vv = window.visualViewport;
    const vw = vv ? vv.offsetLeft + vv.width : window.innerWidth;
    const vh = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const x = Math.max(8, Math.min(cx, vw - CTX_W - 8));
    const y = Math.max(8, Math.min(cy, vh - (c.ask ? 160 : CTX_H) - 8));
    setSlash(null);
    setEmo(null);
    setAsk('');
    setCtx({ ...c, left: x - box.left, top: y - box.top });
  };
  const showCtxRef = useRef(showCtx);
  showCtxRef.current = showCtx;

  /** 핸들 메뉴: 블록을 한 칸 옮기거나 지우거나 나란히 배치를 푼다 */
  const blockAction = (index: number, action: 'up' | 'down' | 'unwrap' | 'delete') => {
    const v = view.current;
    setCtx(null);
    if (!v || latest.current.locked) return;
    const before = v.state.doc.toString();
    let after = before;
    if (action === 'up') after = moveMarkdownBlock(before, index, index - 1);
    else if (action === 'down') after = moveMarkdownBlock(before, index, index + 2);
    else if (action === 'unwrap') after = unwrapColumns(before, index);
    else {
      const b = markdownBlocks(before)[index];
      if (b) {
        // 블록 줄과 뒤따르는 빈 줄 하나를 함께 지운다
        let to = b.to;
        if (before[to] === '\n') to++;
        if (before[to] === '\n') to++;
        after = before.slice(0, b.from) + before.slice(to);
      }
    }
    if (after !== before) v.dispatch({ changes: minimalChange(before, after), userEvent: action === 'delete' ? 'delete.block' : 'move.block' });
    v.focus();
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
              { key: 'ArrowDown', run: () => moveEmoji(1) },
              { key: 'ArrowUp', run: () => moveEmoji(-1) },
              { key: 'Enter', run: () => pickEmojiCurrent() },
              { key: 'Tab', run: () => pickEmojiCurrent() },
              {
                key: 'Escape',
                run: () => {
                  const l = latest.current;
                  if (!l.emoOpen || !l.emo) return false;
                  emoClosedAt.current = l.emo.start;
                  setEmo(null);
                  return true;
                },
              },
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
                  // 편집 모드가 따로 없으니 포커스만 놓는다 (쓰던 글은 저장된다)
                  ed.contentDOM.blur();
                  return true;
                },
              },
              { key: 'Mod-b', run: () => formatRef.current('bold') },
              { key: 'Mod-i', run: () => formatRef.current('italic') },
              { key: 'Mod-Shift-x', run: () => formatRef.current('strike') },
              { key: 'Mod-e', run: () => formatRef.current('code') },
              { key: 'Mod-k', run: () => formatRef.current('link') },
              {
                key: 'Mod-Enter',
                run: (ed) => {
                  ed.contentDOM.blur();
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
          marksField,
          marksDecorations((a, rect) => latest.current.onNote?.(a, rect)),
          EditorView.contentAttributes.of({ 'aria-label': '페이지 본문 (마크다운)', spellcheck: 'false', 'aria-multiline': 'true' }),
          livePreview({
            openPage: (id) => actions().openSession(id, 'main'),
            pageExists: (id) => !!actions().sessions[id],
          }),
          // 번호 목록 가운데를 지우거나 옮기면 아래 번호를 당겨 매긴다 — 같은 트랜잭션(되돌리기 한 번)에 덧붙인다 (ADR-087)
          EditorState.transactionFilter.of((tr: Transaction) => {
            if (!tr.docChanged || tr.annotation(external) || tr.isUserEvent('input.type.compose')) return tr;
            if (!tr.isUserEvent('input') && !tr.isUserEvent('delete') && !tr.isUserEvent('move')) return tr;
            const after = tr.newDoc.toString();
            const renumbered = renumberOrderedLists(after);
            if (renumbered === after) return tr;
            return [tr, { changes: minimalChange(after, renumbered), sequential: true }];
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(external))) latest.current.onChange(u.state.doc.toString());
            if (u.docChanged || u.selectionSet || u.focusChanged) syncRef.current(u.view);
            if (u.docChanged || u.geometryChanged || u.viewportChanged) setLayoutTick((t) => t + 1);
            // P2: onHistory 콜백 — undo/redo 깊이 추적 (A2 undo/redo 버튼이 의존)
            if (_onHistory && (u.docChanged || u.transactions.some((t) => t.isUserEvent('undo') || t.isUserEvent('redo')))) {
              _onHistory({ undo: undoDepth(u.state), redo: redoDepth(u.state) });
            }
          }),
          EditorView.domEventHandlers({
            blur: () => {
              setSlash(null);
              setEmo(null);
              latest.current.onBlur();
            },
            pointerdown: (e) => {
              // P10: 터치 입력 감지
              if (e instanceof PointerEvent) {
                lastPointerType.current = e.pointerType;
              }
              return false;
            },
            // 우클릭은 블록·AI 채우기 메뉴. Shift+우클릭은 기본 메뉴(복사·붙여넣기)
            // 고른 글 위 우클릭은 선택 메뉴(가지·서식)나 기본 메뉴에 맡긴다 (ADR-086)
            // P10: 터치에서는 Ctx를 열지 않음 (블록 메뉴는 핸들로 접근)
            contextmenu: (e, ed) => {
              if (e.shiftKey) return false;
              if (isTouchInput()) return false;
              const { main } = ed.state.selection;
              const at = ed.posAtCoords({ x: e.clientX, y: e.clientY });
              if (!main.empty && at !== null && at >= main.from && at <= main.to) return false;
              e.preventDefault();
              ctxRef.current(e, ed);
              return true;
            },
          }),
        ],
      }),
    });
    view.current = v;
    setEditor(v);
    onView?.(v);
    // 빈 페이지만 바로 쓰기 시작한다. 쓴 글이 있으면 읽다가 누른 곳부터 고친다
    if (!initial.trim()) v.focus();
    return () => {
      onView?.(null);
      setEditor(null);
      v.destroy();
      view.current = null;
    };
    // 세션마다 새 편집기 (PagePanel이 key로 다시 만든다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveEmoji(d: 1 | -1) {
    const l = latest.current;
    if (!l.emoOpen || !l.emo || view.current?.composing) return false;
    const n = l.emo.matches.length;
    setEmoIndex((i) => (i + d + n) % n);
    return true;
  }
  function pickEmojiCurrent() {
    const l = latest.current;
    if (!l.emoOpen || !l.emo || view.current?.composing) return false;
    pickEmojiRef.current(l.emo.matches[l.emoIndex] ?? l.emo.matches[0]!);
    return true;
  }
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

  // 가지·서식 표시를 새로 그린다
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const marks: Marks = {
      branches: (branches ?? []).flatMap((b) => (b.anchor ? [{ id: b.id, anchor: b.anchor, hasSummary: !!b.summary }] : [])),
      annotations: annotations ?? [],
    };
    v.dispatch({ effects: setMarks.of(marks) });
  }, [branches, annotations]);

  // 선택 메뉴와 키보드 바가 이 편집기의 선택에 서식을 넣는다
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    return registerPageEditor(v, {
      format: (kind) => formatRef.current(kind),
      canFill: () => !!onFill && !latest.current.locked,
      openFill: () => {
        if (!onFill || latest.current.locked) return false;
        const sel = v.state.selection.main;
        const at = v.coordsAtPos(sel.to, -1) ?? v.coordsAtPos(sel.head);
        const box = host.current?.getBoundingClientRect();
        showCtxRef.current({ pos: sel.to, ask: true }, at?.left ?? box?.left ?? 0, (at?.bottom ?? box?.top ?? 0) + 6);
        return true;
      },
      block: (kind) => {
        if (latest.current.locked) return false;
        const marker = { h1: '# ', h2: '## ', h3: '### ', bullet: '- ', ordered: '1. ', todo: '- [ ] ' }[kind];
        const sel = v.state.selection.main;
        const doc = v.state.doc;
        const first = doc.lineAt(sel.from).number;
        const last = doc.lineAt(sel.to).number;
        const re = /^(\s*)(#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] )?/;
        const sameKind = (m: string | undefined) => {
          if (!m) return false;
          if (kind === 'ordered') return /^\d+[.)] $/.test(m);
          if (kind === 'todo') return /^[-*+] \[[ xX]\] $/.test(m);
          if (kind === 'bullet') return /^[-*+] $/.test(m);
          return m === marker;
        };
        const lines = [];
        for (let i = first; i <= last; i++) lines.push(doc.line(i));
        const filled = lines.filter((l) => l.text.trim());
        // 고른 줄이 모두 이미 그 모양이면 기호를 뗀다(되돌리기 토글)
        const off = filled.length > 0 && filled.every((l) => sameKind(re.exec(l.text)?.[2]));
        let n = 1;
        const changes = lines
          .filter((l) => l.text.trim() || lines.length === 1)
          .map((l) => {
            const m = re.exec(l.text)!;
            const indent = m[1] ?? '';
            const mark = off ? '' : kind === 'ordered' ? `${n++}. ` : marker;
            return { from: l.from + indent.length, to: l.from + m[0].length, insert: mark };
          });
        v.dispatch({ changes, userEvent: 'input.format' });
        v.focus();
        return true;
      },
      indent: (dir) => {
        if (latest.current.locked) return false;
        if (dir === 1) {
          return indentMore(v);
        } else {
          return indentLess(v);
        }
      },
    });
  }, [onFill]);

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
  useEffect(() => setEmoIndex(0), [emo?.start, emo?.query]);
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
    <div ref={wrap} className="relative">
      <div ref={host} data-page-editor="" data-session-id={sessionId} data-message-id={messageId} className="page-editor min-h-[50vh] pl-6" />
      <PageBlockHandles
        view={editor}
        wrap={wrap}
        tick={layoutTick}
        locked={locked}
        onMenu={(index, b, at) => showCtx({ pos: b.to, ask: false, block: { index, kind: b.kind } }, at.x, at.y)}
      />
      <input
        ref={fileInput}
        type="file"
        hidden
        data-page-embed-input=""
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertEmbed(f);
          else embedAt.current = null;
        }}
      />
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
          data-page-ctx=""
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
              {ctx.block && (
                <>
                  <div className="px-2.5 pt-0.5 pb-1 text-[11.5px] font-medium text-muted">이 블록</div>
                  {(
                    [
                      ['up', '위로 옮기기', ArrowUp],
                      ['down', '아래로 옮기기', ArrowDown],
                      ...(ctx.block.kind === 'columns' ? [['unwrap', '나란히 배치 풀기', Columns2] as const] : []),
                      ['delete', '블록 지우기', Trash2],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      data-block-action={id}
                      onClick={() => blockAction(ctx.block!.index, id)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-[13px] outline-none hover:bg-surface-2 focus-visible:bg-surface-2',
                        id === 'delete' ? 'text-danger' : 'text-fg',
                      )}
                    >
                      <span className="grid size-6 shrink-0 place-items-center rounded-md border border-line bg-surface">
                        <Icon size={14} />
                      </span>
                      {label}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-line" />
                </>
              )}
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
      {emoOpen && emo && (
        <div
          data-page-emoji=""
          onMouseDown={(e) => e.preventDefault()}
          style={{ left: emo.left, top: emo.top }}
          className={cn(
            'animate-pop-in absolute z-20 flex w-64 max-w-full flex-col rounded-xl border border-line bg-elev p-1 shadow-float',
            emo.up ? '-mt-1 -translate-y-full' : 'mt-1',
          )}
        >
          <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium text-muted">이모지 · ↑↓ 선택 · Enter</div>
          <div role="listbox" aria-label="이모지" style={{ maxHeight: EMO_H - 40 }} className="scroll-thin overflow-y-auto">
            {emo.matches.map((m, i) => (
              <button
                key={`${m.emoji}-${m.name}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === emoIndex}
                data-emoji={m.emoji}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setEmoIndex(i)}
                onClick={() => pickEmoji(m)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left', i === emoIndex && 'bg-surface-2')}
              >
                <span className="grid size-7 shrink-0 place-items-center text-[18px] leading-none">{m.emoji}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-fg">:{m.name}:</span>
              </button>
            ))}
          </div>
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
