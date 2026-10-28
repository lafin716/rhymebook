import {
  addCanvasItem,
  canvasBounds,
  CANVAS_MAX_CHARS,
  newId,
  pageDoc,
  parseCanvas,
  removeCanvasItem,
  serializeCanvas,
  type CanvasDoc,
  type CanvasItem,
  type ID,
} from '@branch/core';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import type { PanelVariant } from '../chat/ChatPanel';
import { SessionHeader } from '../chat/SessionHeader';
import { actions, useApp } from '../app/store';
import { pushNotice, syncClient } from '../app/sync';
import { cn } from '../lib/cn';
import { CanvasBoard } from './CanvasBoard';
import { ImportMenu, ImportPicker, type ImportEntry, type ImportSource } from './CanvasImport';
import { CanvasToolbar, INK_COLORS, STROKE_SIZES, type CanvasToolId, type StrokeSizeKey } from './CanvasToolbar';
import { pictureFromFile, type CanvasPicture } from './canvasImage';
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

const isEmpty = (d: CanvasDoc) => d.items.length === 0 && d.strokes.length === 0;

/** 보드 크기에 맞춘 화면. 내용이 없으면 가운데 원점 */
function fitFor(board: HTMLElement | null, target: CanvasDoc): CanvasView | null {
  const r = board?.getBoundingClientRect();
  if (!r) return null;
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
  const [sizeKey, setSizeKey] = useState<StrokeSizeKey>('M');
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [dialog, setDialog] = useState<'menu' | Exclude<ImportSource, 'image'> | null>(null);
  // 실행 취소·다시 실행 가능 여부처럼 렌더에 쓰는 값은 ref를 바꾼 뒤 강제로 다시 그린다
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const boardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const docRef = useRef(doc);
  const hist = useRef<{ past: CanvasDoc[]; future: CanvasDoc[] }>({ past: [], future: [] });
  // savedRef: 마지막으로 저장했거나 바깥에서 받은 글. pendingRef: 저장 대기 중인 글
  const savedRef = useRef<string | undefined>(content);
  const pendingRef = useRef<string | null>(null);
  const refusedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const size = tool === 'marker' ? STROKE_SIZES[sizeKey].marker : STROKE_SIZES[sizeKey].pen;

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
    hist.current = { past: [], future: [] };
    docRef.current = next;
    setDoc(next);
    setSelectedId(null);
    bump();
    if (wasEmpty) {
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
    show(prev);
  }, [show]);

  const redo = useCallback(() => {
    const next = hist.current.future.pop();
    if (!next) return;
    hist.current.past.push(docRef.current);
    show(next);
  }, [show]);

  const fit = () => {
    const v = fitFor(boardRef.current, docRef.current);
    if (v) setView(v);
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
    if (source === 'image') {
      setDialog(null);
      fileRef.current?.click();
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
        onTool={setTool}
        color={color}
        onColor={setColor}
        size={sizeKey}
        onSize={setSizeKey}
        canUndo={hist.current.past.length > 0}
        canRedo={hist.current.future.length > 0}
        onUndo={undo}
        onRedo={redo}
        onFit={fit}
        onImport={() => setDialog('menu')}
        hasSelection={selectedId !== null}
        onDeleteSelected={deleteSelected}
      />
      <CanvasBoard
        doc={doc}
        view={view}
        onView={setView}
        tool={tool}
        color={color}
        size={size}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCommit={commit}
        boardRef={boardRef}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        aria-label="가져올 이미지 파일"
        onChange={(e) => onFiles(e.target.files)}
      />
      {dialog === 'menu' && <ImportMenu onPick={pickSource} onClose={() => setDialog(null)} />}
      {dialog && dialog !== 'menu' && (
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
