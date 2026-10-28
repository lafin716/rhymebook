import {
  addCanvasItem,
  addCanvasPage,
  canvasBounds,
  canvasFlow,
  canvasLayout,
  canvasPageCount,
  canvasPageRects,
  CANVAS_MAX_CHARS,
  keepCanvasSettings,
  newId,
  pageDoc,
  parseCanvas,
  removeCanvasItem,
  serializeCanvas,
  setCanvasBackground,
  setCanvasFlow,
  setCanvasLayout,
  setCanvasPdf,
  type CanvasBackground,
  type CanvasDoc,
  type CanvasItem,
  type CanvasFlow,
  type CanvasLayout,
  type CanvasPenNib,
  type ID,
} from '@branch/core';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { PanelVariant } from '../chat/ChatPanel';
import { SessionHeader } from '../chat/SessionHeader';
import { actions, useApp } from '../app/store';
import { pushNotice, syncClient } from '../app/sync';
import { cn } from '../lib/cn';
import { CanvasBoard } from './CanvasBoard';
import { ImportMenu, ImportPicker, type ImportEntry, type ImportSource } from './CanvasImport';
import { CanvasSettings } from './CanvasSettings';
import { confirm } from '../components/ConfirmDialog';
import { CanvasToolbar, INK_COLORS, type CanvasToolId } from './CanvasToolbar';
import { pictureFromFile, type CanvasPicture } from './canvasImage';
import { pdfFromFile } from './canvasPdf';
import {
  loadFavoriteInks,
  loadPenNib,
  loadStrokeSizes,
  MAX_FAVORITE_INKS,
  saveFavoriteInks,
  savePenNib,
  saveStrokeSizes,
  type StrokeKind,
} from './canvasPrefs';
import { centerView, fitView, toWorld, type CanvasView } from './view';

const SAVE_DELAY = 500;
const HISTORY_MAX = 100;
/** 그림을 가져올 때 긴 변의 최대 길이 (캔버스 px) */
const PICTURE_MAX = 360;
const TEXT_CARD = { w: 320, h: 260 };
/** 같은 자리에 연달아 가져올 때 살짝 어긋나게 */
const CASCADE = 24;
const TOO_BIG = '캔버스가 너무 커서 저장하지 못했어요. 이미지를 줄이거나 나눠서 쓰세요.';
const SAVE_FAIL = '캔버스를 저장하지 못했어요. 잠시 후 다시 시도하세요.';

/** 쪽 나눔 판에서 화면 너비(위아래 방향이면 높이)의 이 비율(최대 SWIPE_MAX px) 넘게 밀면 쪽을 넘긴다 */
const SWIPE_RATIO = 0.15;
const SWIPE_MAX = 80;
/** 맞춤보다 이만큼 넘게 확대했으면 쪽 넘김 대신 쪽 안에서 자유롭게 움직인다 */
const ZOOMED_IN = 1.15;
/** 쪽 둘레 여백 (화면 px) */
const PAGE_PAD = 16;

/** PDF 쪽 그림 용량 상한 (글자 수). 캔버스 저장 상한에서 지금 내용과 여유분을 뺀 만큼까지 */
const PDF_BUDGET = 6_000_000;
const PDF_MARGIN = 300_000;

const isEmpty = (d: CanvasDoc) => d.items.length === 0 && d.strokes.length === 0;

/** 보드 크기에 맞춘 화면. 쪽 나눔이면 page쪽, 자유 판이면 내용 전체(없으면 가운데 원점) */
function fitFor(board: HTMLElement | null, target: CanvasDoc, page = 0): CanvasView | null {
  const r = board?.getBoundingClientRect();
  if (!r) return null;
  const pageRect = canvasPageRects(target)[page];
  if (pageRect) return fitView(pageRect, r.width, r.height, PAGE_PAD);
  const bounds = canvasBounds(target);
  return bounds ? fitView(bounds, r.width, r.height) : centerView(r.width, r.height);
}

export interface CanvasPanelProps {
  sessionId: ID;
  variant?: PanelVariant;
  headerActions?: ReactNode;
  handleClassName?: string;
  className?: string;
}

/**
 * 필기 캔버스 세션 (ADR-079). 본문은 캔버스 JSON 문서 메시지 하나다.
 * 펜·형광펜·지우개·항목 이동으로 그리고, 이미지·대화·페이지·보관함 내용을 가져와 배치한다.
 */
export function CanvasPanel({ sessionId, variant = 'main', headerActions, handleClassName, className }: CanvasPanelProps) {
  const content = useApp((s) => pageDoc(s.messages[sessionId])?.content);

  // 원격 기기는 메시지를 PC에서 받아 와야 캔버스가 보인다
  useEffect(() => {
    const c = syncClient;
    if (c && !c.state.getState().loaded[sessionId]) c.ensureMessages(sessionId);
  }, [sessionId]);

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-col bg-bg', className)} data-panel={variant} data-canvas="" aria-label="캔버스">
      <SessionHeader sessionId={sessionId} compact handleClassName={handleClassName} actions={headerActions} />
      <CanvasEditor key={sessionId} sessionId={sessionId} content={content} />
    </section>
  );
}

/** 세션이 바뀌면 key로 새로 만든다. 편집 상태와 저장 대기 글이 세션마다 따로 있어야 한다 */
function CanvasEditor({ sessionId, content }: { sessionId: ID; content: string | undefined }) {
  const [doc, setDoc] = useState<CanvasDoc>(() => parseCanvas(content));
  const [view, setView] = useState<CanvasView>({ x: 0, y: 0, k: 1 });
  const [tool, setTool] = useState<CanvasToolId>('pen');
  const [color, setColor] = useState<string>(INK_COLORS[0]?.hex ?? '#1f2937');
  const [sizes, setSizes] = useState(loadStrokeSizes);
  const [nib, setNib] = useState(loadPenNib);
  const [favorites, setFavorites] = useState(loadFavoriteInks);
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [dialog, setDialog] = useState<'menu' | 'settings' | Exclude<ImportSource, 'image' | 'pdf'> | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [animate, setAnimate] = useState(false);
  // 실행 취소·다시 실행 가능 여부처럼 렌더에 쓰는 값은 ref를 바꾼 뒤 강제로 다시 그린다
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const boardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const pdfBusy = useRef(false);
  const docRef = useRef(doc);
  const hist = useRef<{ past: CanvasDoc[]; future: CanvasDoc[] }>({ past: [], future: [] });
  // savedRef: 마지막으로 저장했거나 바깥에서 받은 글. pendingRef: 저장 대기 중인 글
  const savedRef = useRef<string | undefined>(content);
  const pendingRef = useRef<string | null>(null);
  const refusedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const size = tool === 'marker' ? sizes.marker : sizes.pen;
  const layout = canvasLayout(doc);
  const flow = canvasFlow(doc);
  const pageCount = canvasPageCount(doc);
  // 바깥에서 쪽이 줄었을 수 있다
  const page = Math.min(pageIdx, Math.max(0, pageCount - 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 쪽 자리는 판 설정에만 달렸다
  const pageRects = useMemo(() => canvasPageRects(doc), [doc.layout, doc.pages, doc.flow, doc.pdf]);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  });
  const animTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(animTimer.current), []);

  /** 손동작으로 화면을 옮길 때는 쪽 넘김 애니메이션을 끈다 */
  const moveView = useCallback((f: (v: CanvasView) => CanvasView) => {
    clearTimeout(animTimer.current);
    setAnimate(false);
    setView(f);
  }, []);

  const glideTo = (v: CanvasView) => {
    clearTimeout(animTimer.current);
    setAnimate(true);
    setView(v);
    animTimer.current = setTimeout(() => setAnimate(false), 250);
  };

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const json = pendingRef.current;
    if (json === null) return;
    if (json === savedRef.current) {
      pendingRef.current = null;
      return;
    }
    // 저장 실패(너무 큼 포함)면 글을 버리지 않고 대기시켜, 다음 편집이나 나갈 때 다시 시도한다
    if (json.length <= CANVAS_MAX_CHARS && actions().updatePage(sessionId, json)) {
      savedRef.current = json;
      pendingRef.current = null;
      refusedRef.current = false;
      return;
    }
    if (!refusedRef.current) pushNotice(json.length > CANVAS_MAX_CHARS ? TOO_BIG : SAVE_FAIL);
    refusedRef.current = true;
  }, [sessionId]);

  // 세션을 떠나거나 화면을 닫을 때 저장 대기 글을 남기지 않는다
  useEffect(() => {
    // 창을 닫거나 앱을 끝낼 때·백그라운드로 갈 때도 대기 글을 바로 넘긴다
    const onHide = () => flush();
    const onVisibility = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  // 처음 열 때 내용 전체가 보이게 맞춘다
  useEffect(() => {
    const v = fitFor(boardRef.current, docRef.current);
    if (v) setView(v);
  }, []);

  // 바깥(원격 기기 등)에서 본문이 바뀌면 따라간다. 내가 저장 대기 중이면 내 글을 우선한다
  useEffect(() => {
    if (content === undefined || content === savedRef.current || pendingRef.current !== null) return;
    savedRef.current = content;
    const wasEmpty = isEmpty(docRef.current);
    const next = parseCanvas(content);
    const cur = docRef.current;
    const relayout = canvasLayout(next) !== canvasLayout(cur) || canvasFlow(next) !== canvasFlow(cur) || next.pdf?.pages.length !== cur.pdf?.pages.length || next.pdf?.name !== cur.pdf?.name;
    hist.current = { past: [], future: [] };
    docRef.current = next;
    setDoc(next);
    setSelectedId(null);
    bump();
    if (wasEmpty || relayout) {
      if (relayout) setPageIdx(0);
      const v = fitFor(boardRef.current, next);
      if (v) setView(v);
    }
  }, [content]);

  const scheduleSave = useCallback(
    (next: CanvasDoc) => {
      pendingRef.current = serializeCanvas(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    },
    [flush],
  );

  const show = useCallback(
    (next: CanvasDoc) => {
      docRef.current = next;
      setDoc(next);
      scheduleSave(next);
      bump();
    },
    [scheduleSave],
  );

  // 손을 뗄 때마다 한 칸. 실행 취소 기록은 최대 HISTORY_MAX개
  const commit = useCallback(
    (next: CanvasDoc) => {
      if (next === docRef.current) return;
      hist.current.past = [...hist.current.past.slice(-(HISTORY_MAX - 1)), docRef.current];
      hist.current.future = [];
      show(next);
    },
    [show],
  );

  const undo = useCallback(() => {
    const prev = hist.current.past.pop();
    if (!prev) return;
    hist.current.future.push(docRef.current);
    show(keepCanvasSettings(prev, docRef.current));
  }, [show]);

  const redo = useCallback(() => {
    const next = hist.current.future.pop();
    if (!next) return;
    hist.current.past.push(docRef.current);
    show(keepCanvasSettings(next, docRef.current));
  }, [show]);

  const fit = () => {
    const v = fitFor(boardRef.current, docRef.current, page);
    if (v) glideTo(v);
  };

  /** i쪽으로 넘긴다. 마지막 쪽 다음이면 빈 쪽을 하나 더한다 */
  const goPage = (i: number) => {
    let d = docRef.current;
    const n = canvasPageCount(d);
    if (!n) return;
    if (i >= n) {
      const more = addCanvasPage(d);
      if (more === d) i = n - 1;
      else {
        show(more);
        d = more;
      }
    }
    i = Math.max(0, i);
    setPageIdx(i);
    const v = fitFor(boardRef.current, d, i);
    if (v) glideTo(v);
  };

  /** 화면 이동이 끝났을 때: 쪽 방향으로 충분히 밀었으면 쪽을 넘기고, 아니면 지금 쪽에 다시 맞춘다 */
  const settle = () => {
    if (!pageCount) return;
    const r = boardRef.current?.getBoundingClientRect();
    const fitNow = fitFor(boardRef.current, docRef.current, page);
    if (!r || !fitNow) return;
    const v = viewRef.current;
    // 확대해서 보고 있으면 쪽 안을 자유롭게 움직인다
    if (v.k > fitNow.k * ZOOMED_IN) return;
    // 지금 쪽 가운데가 화면 가운데에서 쪽 방향으로 얼마나 밀렸나 (화면 px)
    const rect = pageRects[page];
    if (!rect) return;
    const vertical = flow === 'vertical';
    const d = vertical ? v.y + (rect.y + rect.h / 2) * v.k - r.height / 2 : v.x + (rect.x + rect.w / 2) * v.k - r.width / 2;
    const th = Math.min(SWIPE_MAX, (vertical ? r.height : r.width) * SWIPE_RATIO);
    if (d < -th) goPage(page + 1);
    else if (d > th && page > 0) goPage(page - 1);
    else goPage(page);
  };

  const changeLayout = async (next: CanvasLayout) => {
    setDialog(null);
    if (docRef.current.pdf && next !== 'pdf') {
      const ok = await confirm({
        title: 'PDF 모드를 끝낼까요?',
        message: '가져온 PDF 쪽은 캔버스에서 빠지고, 그 위에 쓴 필기와 카드는 남아요.',
        confirmLabel: '바꾸기',
        tone: 'danger',
      });
      if (!ok) return;
    }
    const d = setCanvasLayout(docRef.current, next);
    if (d === docRef.current) return;
    show(d);
    setPageIdx(0);
    const v = fitFor(boardRef.current, d, 0);
    if (v) glideTo(v);
  };

  /** 쪽 방향을 바꾸면 지금 쪽을 새 자리에서 다시 맞춘다 */
  const changeFlow = (next: CanvasFlow) => {
    const d = setCanvasFlow(docRef.current, next);
    if (d === docRef.current) return;
    show(d);
    const v = fitFor(boardRef.current, d, page);
    if (v) glideTo(v);
  };

  /** 바탕은 설정이라 실행 취소 기록에 넣지 않는다 */
  const changeBackground = (bg: CanvasBackground) => {
    const d = setCanvasBackground(docRef.current, bg);
    if (d !== docRef.current) show(d);
  };

  const changeSize = (kind: StrokeKind, n: number) => {
    setSizes((s) => {
      const next = { ...s, [kind]: n };
      saveStrokeSizes(next);
      return next;
    });
  };

  const changeNib = (n: CanvasPenNib) => {
    setNib(n);
    savePenNib(n);
  };

  const toggleFavorite = (hex: string) => {
    setFavorites((list) => {
      const next = list.includes(hex) ? list.filter((h) => h !== hex) : [...list, hex].slice(0, MAX_FAVORITE_INKS);
      saveFavoriteInks(next);
      return next;
    });
  };

  /** PDF를 가져오면 캔버스가 PDF 모드가 된다 — 쪽마다 PDF 한 장 */
  const onPdf = async (files: FileList | null) => {
    const f = files?.[0];
    if (pdfRef.current) pdfRef.current.value = '';
    if (!f || pdfBusy.current) return;
    if (docRef.current.pdf) {
      const ok = await confirm({
        title: 'PDF를 바꿀까요?',
        message: `지금 PDF(${docRef.current.pdf.name}) 대신 ${f.name} 을(를) 놓아요. 필기와 카드는 그대로 남아요.`,
        confirmLabel: '바꾸기',
      });
      if (!ok) return;
    }
    pdfBusy.current = true;
    pushNotice('PDF 불러오는 중…');
    try {
      const { pdf: _old, ...others } = docRef.current;
      const used = serializeCanvas(others).length;
      const budget = Math.min(PDF_BUDGET, CANVAS_MAX_CHARS - used - PDF_MARGIN);
      if (budget <= 0) throw new Error(TOO_BIG);
      const { pdf, total, truncated } = await pdfFromFile(f, budget);
      const d = setCanvasPdf(docRef.current, pdf);
      if (d === docRef.current) throw new Error(`${f.name} 에 쪽이 없어요.`);
      show(d);
      setSelectedId(null);
      setPageIdx(0);
      const v = fitFor(boardRef.current, d, 0);
      if (v) glideTo(v);
      if (truncated) pushNotice(`${total}쪽 중 앞 ${pdf.pages.length}쪽만 가져왔어요.`);
    } catch (err) {
      pushNotice(err instanceof Error ? err.message : `${f.name} 을(를) 가져오지 못했어요.`);
    } finally {
      pdfBusy.current = false;
    }
  };

  /** 펜·형광펜·지우개로 바꾸면 고른 항목을 놓는다 — 그리는 중에 그림이 잡히지 않게 */
  const pickTool = (t: CanvasToolId) => {
    setTool(t);
    if (t !== 'select') setSelectedId(null);
  };

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    commit(removeCanvasItem(docRef.current, selectedId));
    setSelectedId(null);
  }, [selectedId, commit]);

  /** 가져온 것들을 보드 가운데에 놓는다. 한 번에 가져온 것은 실행 취소 한 칸이다 */
  const addEntries = (entries: ImportEntry[]) => {
    const r = boardRef.current?.getBoundingClientRect();
    const c = toWorld(view, (r?.width ?? 0) / 2, (r?.height ?? 0) / 2);
    let next = docRef.current;
    let lastId: ID | null = null;
    entries.forEach((e, j) => {
      const off = ((next.items.length + j) % 8) * CASCADE;
      const id = newId('i');
      let item: CanvasItem;
      if (e.kind === 'image') {
        const s = Math.min(1, PICTURE_MAX / Math.max(e.w, e.h));
        const w = e.w * s;
        const h = e.h * s;
        item = { type: 'image', id, x: c.x - w / 2 + off, y: c.y - h / 2 + off, w, h, src: e.src, name: e.name };
      } else {
        item = {
          type: 'text',
          id,
          x: c.x - TEXT_CARD.w / 2 + off,
          y: c.y - TEXT_CARD.h / 2 + off,
          w: TEXT_CARD.w,
          h: TEXT_CARD.h,
          title: e.title,
          text: e.text,
          source: e.source,
        };
      }
      next = addCanvasItem(next, item);
      lastId = id;
    });
    commit(next);
    // 가져온 직후에는 바로 옮기거나 크기를 바꿀 수 있게 선택 도구로
    setTool('select');
    setSelectedId(lastId);
  };

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (fileRef.current) fileRef.current.value = '';
    const entries: ImportEntry[] = [];
    for (const f of list) {
      try {
        const p: CanvasPicture = await pictureFromFile(f);
        entries.push({ kind: 'image', ...p, name: f.name });
      } catch (err) {
        pushNotice(err instanceof Error ? err.message : `${f.name} 을(를) 가져오지 못했어요.`);
      }
    }
    if (entries.length) addEntries(entries);
  };

  const pickSource = (source: ImportSource) => {
    if (source === 'image' || source === 'pdf') {
      setDialog(null);
      (source === 'pdf' ? pdfRef : fileRef).current?.click();
      return;
    }
    setDialog(source);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // 글 입력 중에는 단축키를 가로채지 않는다
      if (t?.closest?.('input, textarea, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, undo, redo, deleteSelected]);

  return (
    <>
      <CanvasToolbar
        tool={tool}
        onTool={pickTool}
        color={color}
        onColor={setColor}
        sizes={sizes}
        onSize={changeSize}
        nib={nib}
        onNib={changeNib}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        canUndo={hist.current.past.length > 0}
        canRedo={hist.current.future.length > 0}
        onUndo={undo}
        onRedo={redo}
        onFit={fit}
        fitLabel={pageCount ? '쪽 맞춤' : '전체 보기'}
        onSettings={() => setDialog('settings')}
        onImport={() => setDialog('menu')}
        hasSelection={selectedId !== null}
        onDeleteSelected={deleteSelected}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <CanvasBoard
          doc={doc}
          view={view}
          onView={moveView}
          tool={tool}
          color={color}
          size={size}
          nib={nib}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onCommit={commit}
          boardRef={boardRef}
          pages={pageRects}
          onSettle={settle}
          animate={animate}
        />
        {pageCount > 0 && <PageNav page={page} count={pageCount} vertical={flow === 'vertical'} canAdd={layout !== 'pdf'} onGo={goPage} />}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        aria-label="가져올 이미지 파일"
        onChange={(e) => onFiles(e.target.files)}
      />
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden aria-label="가져올 PDF 파일" onChange={(e) => onPdf(e.target.files)} />
      {dialog === 'settings' && (
        <CanvasSettings
          layout={layout}
          onLayout={changeLayout}
          flow={flow}
          onFlow={changeFlow}
          pdfName={doc.pdf?.name}
          bg={doc.bg}
          onBackground={changeBackground}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'menu' && <ImportMenu onPick={pickSource} onClose={() => setDialog(null)} />}
      {dialog && dialog !== 'menu' && dialog !== 'settings' && (
        <ImportPicker
          source={dialog}
          onPick={(entry) => {
            setDialog(null);
            addEntries([entry]);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

const NAV_BTN = 'grid size-11 place-items-center rounded-full text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-40 md:size-9';

/** 쪽 나눔 판 아래의 쪽 넘김: 이전 · n / 전체 · 다음(마지막 쪽이면 새 쪽, PDF 판은 끝) */
function PageNav({ page, count, vertical, canAdd, onGo }: { page: number; count: number; vertical: boolean; canAdd: boolean; onGo(i: number): void }) {
  const end = page >= count - 1;
  const last = end && canAdd;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center pb-[env(safe-area-inset-bottom)]">
      <nav aria-label="쪽 넘김" data-canvas-pages="" className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-line bg-surface/95 px-1 shadow-md">
        <button type="button" aria-label="이전 쪽" title="이전 쪽" disabled={page === 0} onClick={() => onGo(page - 1)} className={NAV_BTN}>
          {vertical ? <ChevronUp size={18} /> : <ChevronLeft size={18} />}
        </button>
        <span className="min-w-12 text-center text-[13px] text-fg-2 tabular-nums" aria-live="polite">
          {page + 1} / {count}
        </span>
        <button type="button" aria-label={last ? '새 쪽' : '다음 쪽'} title={last ? '새 쪽' : '다음 쪽'} disabled={end && !canAdd} onClick={() => onGo(page + 1)} className={NAV_BTN}>
          {last ? <Plus size={18} /> : vertical ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>
      </nav>
    </div>
  );
}
