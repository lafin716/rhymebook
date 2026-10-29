import { describe, expect, it } from 'vitest';
import {
  addCanvasItem,
  addCanvasPage,
  addStroke,
  CANVAS_MAX_PAGES,
  CANVAS_PAGE_GAP,
  canvasFlow,
  canvasLayout,
  canvasPageCount,
  canvasPageRect,
  canvasPageAt,
  canvasPageRects,
  clipStrokePoints,
  CANVAS_PAPER,
  keepCanvasSettings,
  setCanvasBackground,
  setCanvasPdf,
  canvasBounds,
  canvasColorAt,
  canvasText,
  compactPoints,
  docText,
  emptyCanvas,
  eraseStrokesAt,
  parseCanvas,
  pageCardText,
  raiseCanvasItem,
  removeCanvasItem,
  serializeCanvas,
  setCanvasFlow,
  setCanvasLayout,
  sessionCardText,
  updateCanvasItem,
  type CanvasDoc,
  type CanvasStroke,
} from '../src/canvas';
import { buildSummaryRequest, buildSystemPrompt } from '../src/context';
import type { ID, Message, Session } from '../src/model';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import { createAppStore, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { draftSessionIds } from '../src/tree';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const stroke = (id: string, points: number[], size = 4): CanvasStroke => ({ id, tool: 'pen', color: '#000000', size, points });

function makeStore() {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...createSeed(0), view: emptyView(SEED_IDS.root) },
  });
  return store;
}

describe('canvas doc', () => {
  it('parse/serialize round-trips and tolerates broken input', () => {
    let doc: CanvasDoc = emptyCanvas();
    doc = addCanvasItem(doc, { type: 'image', id: 'i1', x: 0, y: 0, w: 100, h: 50, src: PNG, name: 'a.png' });
    doc = addCanvasItem(doc, { type: 'text', id: 't1', x: 10, y: 10, w: 200, h: 100, title: '세션', text: '본문', source: { kind: 'session', id: 's1' } });
    doc = addStroke(doc, stroke('k1', [0, 0, 0.5, 10, 10, 0.5]));
    expect(parseCanvas(serializeCanvas(doc))).toEqual(doc);
    expect(parseCanvas('')).toEqual(emptyCanvas());
    expect(parseCanvas('{bad')).toEqual(emptyCanvas());
    expect(parseCanvas('# 페이지 글')).toEqual(emptyCanvas());
  });

  it('drops invalid items and strokes', () => {
    const raw = JSON.stringify({
      v: 1,
      items: [
        { type: 'image', id: 'i1', x: 0, y: 0, w: 1, h: 1, src: 'https://evil/x.png' },
        { type: 'image', id: 'i2', x: 0, y: 0, w: 1, h: 1, src: 'data:image/svg+xml;base64,AAAA' },
        { type: 'text', id: 't1', x: 0, y: 0, w: 0, h: 1, title: 'x', text: '' },
        { type: 'text', id: 't2', x: 0, y: 0, w: 5, h: 5, title: 'ok', text: 'y', source: { kind: 'evil', id: 'z' } },
      ],
      strokes: [
        { id: 'a', tool: 'pen', color: 'red', size: 2, points: [0, 0, 1] },
        { id: 'b', tool: 'pen', color: '#000000', size: 2, points: [0, 0] },
        { id: 'c', tool: 'laser', color: '#000000', size: 2, points: [0, 0, 1] },
        { id: 'd', tool: 'marker', color: '#ffee00', size: 20, points: [0, 0, 1] },
      ],
    });
    const doc = parseCanvas(raw);
    expect(doc.items).toEqual([{ type: 'text', id: 't2', x: 0, y: 0, w: 5, h: 5, title: 'ok', text: 'y' }]);
    expect(doc.strokes.map((s) => s.id)).toEqual(['d']);
  });

  it('펜 종류는 펜 획에만 남고, 만년필(기본)·모르는 값은 버린다', () => {
    const raw = JSON.stringify({
      v: 1,
      items: [],
      strokes: [
        { id: 'a', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 1], nib: 'brush' },
        { id: 'b', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 1], nib: 'fountain' },
        { id: 'c', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 1], nib: 'crayon' },
        { id: 'd', tool: 'marker', color: '#ffee00', size: 20, points: [0, 0, 1], nib: 'pencil' },
      ],
    });
    const doc = parseCanvas(raw);
    expect(doc.strokes.map((s) => s.nib)).toEqual(['brush', undefined, undefined, undefined]);
    expect(doc.strokes[1]).not.toHaveProperty('nib');
    expect(parseCanvas(serializeCanvas(doc))).toEqual(doc);
  });

  it('compactPoints thins close points, keeps the last one and defaults pressure', () => {
    expect(compactPoints([0, 0, 0, 0.2, 0.2, 0.5, 5, 5, 0.333, 5.04, 5.04, 0.5])).toEqual([0, 0, 0.5, 5, 5, 0.33]);
    expect(compactPoints([0, 0, 0.5, 0.3, 0, 0.5, 0.6, 0, 0.5])).toEqual([0, 0, 0.5, 0.6, 0, 0.5]);
  });

  it('eraser removes only strokes it touches', () => {
    let doc = addStroke(emptyCanvas(), stroke('a', [0, 0, 0.5, 100, 0, 0.5], 2));
    doc = addStroke(doc, stroke('b', [0, 50, 0.5, 100, 50, 0.5], 2));
    expect(eraseStrokesAt(doc, 50, 25, 5)).toBe(doc);
    expect(eraseStrokesAt(doc, 50, 3, 3).strokes.map((s) => s.id)).toEqual(['b']);
    expect(eraseStrokesAt(addStroke(emptyCanvas(), stroke('dot', [5, 5, 0.5])), 6, 6, 2).strokes).toEqual([]);
  });

  it('eyedropper picks the topmost stroke color, else the background', () => {
    let doc = addStroke(emptyCanvas(), { ...stroke('a', [0, 0, 0.5, 100, 0, 0.5], 4), color: '#DC2626' });
    doc = addStroke(doc, { ...stroke('b', [50, -50, 0.5, 50, 50, 0.5], 4), color: '#2563eb' });
    expect(canvasColorAt(doc, 10, 0, 2)).toBe('#dc2626');
    expect(canvasColorAt(doc, 50, 0, 2)).toBe('#2563eb');
    expect(canvasColorAt(doc, 10, 30, 2)).toBe(CANVAS_PAPER);
    expect(canvasColorAt(setCanvasBackground(doc, { color: '#1f2937' }), 10, 30, 2)).toBe('#1f2937');
  });

  it('item move/resize/raise/remove and bounds', () => {
    let doc = addCanvasItem(emptyCanvas(), { type: 'image', id: 'a', x: 0, y: 0, w: 100, h: 100, src: PNG });
    doc = addCanvasItem(doc, { type: 'image', id: 'b', x: 200, y: 0, w: 50, h: 50, src: PNG });
    doc = updateCanvasItem(doc, 'a', { x: 10.04, w: 3 });
    expect(doc.items[0]).toMatchObject({ x: 10, w: 24 });
    expect(updateCanvasItem(doc, 'nope', { x: 1 })).toBe(doc);
    expect(raiseCanvasItem(doc, 'a').items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(raiseCanvasItem(doc, 'b')).toBe(doc);
    doc = addStroke(doc, stroke('k', [0, 300, 0.5], 10));
    expect(canvasBounds(doc)).toEqual({ x: -5, y: 0, w: 255, h: 305 });
    expect(removeCanvasItem(doc, 'a').items.map((i) => i.id)).toEqual(['b']);
    expect(canvasBounds(emptyCanvas())).toBeNull();
  });
});

describe('canvas card text', () => {
  const msg = (role: 'user' | 'assistant', content: string, extra: Partial<Message> = {}): Message =>
    ({ id: `m-${content.length}-${role}`, sessionId: 's', role, content, status: 'done', createdAt: 0, ...extra }) as Message;

  it('sessionCardText: bold questions, answers, no data URLs, skips errors', () => {
    const text = sessionCardText([
      msg('user', '어텐션이 뭐야?\n자세히'),
      msg('assistant', '가중합이다. ![그림](data:image/png;base64,AAAA)'),
      msg('assistant', '실패', { status: 'error' }),
    ]);
    expect(text).toBe('**🙋 어텐션이 뭐야?  \n자세히**\n\n---\n\n가중합이다. _🖼 그림_');
    expect(sessionCardText([msg('assistant', 'x'.repeat(50))], 10)).toBe('xxxxxxxxxx\n\n…(생략)');
  });

  it('pageCardText drops embedded files', () => {
    expect(pageCardText('# 제목\n[보고서.pdf](data:application/pdf;base64,AAA)')).toBe('# 제목\n보고서.pdf');
  });

  it('canvasText/docText describe cards, images and strokes', () => {
    let doc = addCanvasItem(emptyCanvas(), { type: 'text', id: 't', x: 0, y: 0, w: 9, h: 9, title: '메모', text: '핵심 개념' });
    doc = addCanvasItem(doc, { type: 'image', id: 'i', x: 0, y: 0, w: 9, h: 9, src: PNG, name: '판서.png' });
    doc = addStroke(doc, stroke('k', [0, 0, 0.5]));
    const text = canvasText(doc);
    expect(text).toContain('## 메모\n핵심 개념');
    expect(text).toContain('[이미지: 판서.png]');
    expect(text).toContain('[손글씨 필기 1획]');
    expect(docText({ kind: 'canvas' }, serializeCanvas(doc))).toBe(canvasText(doc, Infinity));
    expect(docText({ kind: 'page' }, '{"v":1}')).toBe('{"v":1}');
  });
});

describe('canvas sessions in the store', () => {
  it('newPage({kind: canvas}) makes a doc session that rejects chat and is not a draft', () => {
    const store = makeStore();
    const id = store.getState().newPage(undefined, { kind: 'canvas' }) as ID;
    const s = store.getState().sessions[id]!;
    expect(s).toMatchObject({ kind: 'canvas', title: '새 캔버스', parentId: null });
    expect(draftSessionIds(store.getState().sessions, store.getState().messages).has(id)).toBe(false);
    expect(store.getState().sendMessage(id, '질문')).toBe(false);
    const body = serializeCanvas(addStroke(emptyCanvas(), stroke('k', [1, 1, 0.5])));
    expect(store.getState().updatePage(id, body)).toBe(true);
    expect(parseCanvas(store.getState().messages[id]?.[0]?.content).strokes).toHaveLength(1);
  });

  it('child of a canvas gets canvas text (not JSON) as parent context; summary uses text', () => {
    const store = makeStore();
    const id = store.getState().newPage(undefined, { kind: 'canvas' }) as ID;
    const doc = addCanvasItem(emptyCanvas(), { type: 'image', id: 'i', x: 0, y: 0, w: 9, h: 9, src: PNG });
    const withText = addCanvasItem(doc, { type: 'text', id: 't', x: 0, y: 0, w: 9, h: 9, title: '메모', text: '핵심' });
    store.getState().updatePage(id, serializeCanvas(withText));
    const child = store.getState().newSubSession(id, undefined, { focus: false }) as ID;
    const st = store.getState();
    const prompt = buildSystemPrompt({ sessions: st.sessions, messages: st.messages, sessionId: child });
    expect(prompt).toContain('### 부모 캔버스');
    expect(prompt).toContain('## 메모\n핵심');
    expect(prompt).not.toContain('base64');
    const req = buildSummaryRequest(st.sessions[id] as Session, st.messages[id] ?? []);
    expect(req.messages[0]!.content).toContain('핵심');
    expect(req.messages[0]!.content).not.toContain('base64');
  });
});

describe('canvas layout (쪽 나눔)', () => {
  it('자유 판은 쪽이 없고, 쪽 나눔은 첫 쪽 가운데가 원점이며 오른쪽으로 이어진다', () => {
    expect(canvasPageRect('free', 0)).toBeNull();
    expect(canvasPageRect('landscape', 0)).toEqual({ x: -800, y: -450, w: 1600, h: 900 });
    expect(canvasPageRect('portrait', 1)).toEqual({ x: 900 + CANVAS_PAGE_GAP - 450, y: -800, w: 900, h: 1600 });
  });

  it('판 모양을 바꿔도 내용은 그대로, 쪽 수는 지킨다', () => {
    const base = addStroke(emptyCanvas(), { id: 's1', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 0.5, 5, 5, 0.5] });
    const land = setCanvasLayout(base, 'landscape');
    expect(canvasLayout(land)).toBe('landscape');
    expect(canvasPageCount(land)).toBe(1);
    const two = addCanvasPage(land);
    expect(canvasPageCount(two)).toBe(2);
    const port = setCanvasLayout(two, 'portrait');
    expect(canvasPageCount(port)).toBe(2);
    expect(port.strokes).toBe(base.strokes);
    const free = setCanvasLayout(port, 'free');
    expect(free).not.toHaveProperty('layout');
    expect(free).not.toHaveProperty('pages');
    expect(canvasPageCount(free)).toBe(0);
    expect(addCanvasPage(free)).toBe(free);
    expect(setCanvasLayout(free, 'free')).toBe(free);
  });

  it('저장·읽기에서 판 모양과 쪽 수를 지키고 잘못된 값은 버린다', () => {
    const doc = addCanvasPage(addCanvasPage(setCanvasLayout(emptyCanvas(), 'portrait')));
    expect(parseCanvas(serializeCanvas(doc))).toEqual(doc);
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], layout: 'weird', pages: 3 }))).toEqual(emptyCanvas());
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], layout: 'landscape', pages: -2 })).pages).toBe(1);
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], layout: 'landscape', pages: 1e9 })).pages).toBe(CANVAS_MAX_PAGES);
  });

  it('쪽 방향: 위아래면 쪽이 아래로 이어지고, 판 모양을 바꿔도 지키며 자유 판에서는 버린다', () => {
    expect(canvasPageRect('landscape', 1, 'vertical')).toEqual({ x: -800, y: 900 + CANVAS_PAGE_GAP - 450, w: 1600, h: 900 });
    expect(setCanvasFlow(emptyCanvas(), 'vertical')).toEqual(emptyCanvas());
    const land = setCanvasLayout(emptyCanvas(), 'landscape');
    expect(canvasFlow(land)).toBe('horizontal');
    const vert = setCanvasFlow(land, 'vertical');
    expect(canvasFlow(vert)).toBe('vertical');
    expect(setCanvasFlow(vert, 'vertical')).toBe(vert);
    const port = setCanvasLayout(vert, 'portrait');
    expect(port.flow).toBe('vertical');
    expect(parseCanvas(serializeCanvas(port))).toEqual(port);
    expect(setCanvasLayout(port, 'free')).not.toHaveProperty('flow');
    expect(setCanvasFlow(vert, 'horizontal')).not.toHaveProperty('flow');
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], layout: 'landscape', flow: 'diag' }))).not.toHaveProperty('flow');
  });

  it('A4 가로: 1600×1131 쪽으로 나뉜다', () => {
    const a4 = setCanvasLayout(emptyCanvas(), 'a4-landscape');
    expect(canvasPageRect('a4-landscape', 0)).toEqual({ x: -800, y: -565.5, w: 1600, h: 1131 });
    expect(parseCanvas(serializeCanvas(addCanvasPage(a4)))).toEqual(addCanvasPage(a4));
  });

  it('A4 세로: 1131×1600 쪽으로 나뉜다', () => {
    const a4 = setCanvasLayout(emptyCanvas(), 'a4-portrait');
    expect(canvasPageRect('a4-portrait', 0)).toEqual({ x: -565.5, y: -800, w: 1131, h: 1600 });
    expect(parseCanvas(serializeCanvas(addCanvasPage(a4)))).toEqual(addCanvasPage(a4));
  });
});

describe('캔버스 PDF 판', () => {
  const pdf = { name: '강의.pdf', pages: [{ src: PNG, w: 1190, h: 1684 }, { src: PNG, w: 1684, h: 1190 }] };

  it('쪽마다 PDF 한 장, 쪽 크기는 PDF 쪽을 따라 쪽 방향으로 이어진다', () => {
    const doc = setCanvasPdf(addStroke(emptyCanvas(), { id: 's', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 0.5] }), pdf);
    expect(canvasLayout(doc)).toBe('pdf');
    expect(canvasPageCount(doc)).toBe(2);
    expect(doc.strokes).toHaveLength(1);
    expect(canvasPageRects(doc)).toEqual([
      { x: -595, y: -842, w: 1190, h: 1684 },
      { x: 595 + CANVAS_PAGE_GAP, y: -595, w: 1684, h: 1190 },
    ]);
    const vert = setCanvasFlow(doc, 'vertical');
    expect(canvasPageRects(vert)[1]).toEqual({ x: -842, y: 842 + CANVAS_PAGE_GAP, w: 1684, h: 1190 });
    expect(addCanvasPage(doc)).toBe(doc);
    expect(canvasText(doc)).toContain('[PDF: 강의.pdf]');
    expect(parseCanvas(serializeCanvas(vert))).toEqual(vert);
  });

  it('다른 판으로 바꾸면 PDF를 빼고, 깨진 PDF는 자유 판으로 읽는다', () => {
    const doc = setCanvasPdf(emptyCanvas(), pdf);
    const land = setCanvasLayout(doc, 'landscape');
    expect(land).not.toHaveProperty('pdf');
    expect(canvasPageCount(land)).toBe(1);
    expect(setCanvasLayout(doc, 'pdf')).toBe(doc);
    expect(setCanvasPdf(emptyCanvas(), { name: 'x', pages: [] })).toEqual(emptyCanvas());
    const bad = { ...doc, pdf: { name: 'x', pages: [{ src: 'javascript:1', w: 10, h: 10 }] } };
    expect(canvasLayout(parseCanvas(JSON.stringify(bad)))).toBe('free');
  });
});

describe('캔버스 바탕', () => {
  it('색·무늬를 저장하고 기본 종이·민무늬는 빼며 잘못된 값은 버린다', () => {
    const d = setCanvasBackground(emptyCanvas(), { color: '#FFFFFF', pattern: 'lines' });
    expect(d.bg).toEqual({ color: '#ffffff', pattern: 'lines' });
    expect(parseCanvas(serializeCanvas(d))).toEqual(d);
    expect(setCanvasBackground(d, { color: '#ffffff', pattern: 'lines' })).toBe(d);
    expect(setCanvasBackground(d, { color: CANVAS_PAPER })).not.toHaveProperty('bg');
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], bg: { color: 'red', pattern: 'dots' } }))).not.toHaveProperty('bg');
    expect(parseCanvas(JSON.stringify({ v: 1, items: [], strokes: [], bg: { pattern: 'grid-fine' } })).bg).toEqual({ pattern: 'grid-fine' });
  });

  it('실행 취소로 되돌려도 설정(판·PDF·바탕)은 지금 값을 지킨다', () => {
    const old = addStroke(emptyCanvas(), { id: 's', tool: 'pen', color: '#000000', size: 2, points: [0, 0, 0.5] });
    const cur = setCanvasBackground(setCanvasPdf(emptyCanvas(), { name: 'a', pages: [{ src: PNG, w: 10, h: 10 }] }), { pattern: 'grid-wide' });
    const kept = keepCanvasSettings(old, cur);
    expect(kept.strokes).toHaveLength(1);
    expect(kept.layout).toBe('pdf');
    expect(kept.pdf).toBe(cur.pdf);
    expect(kept.bg).toEqual({ pattern: 'grid-wide' });
    expect(keepCanvasSettings(cur, emptyCanvas())).toEqual(emptyCanvas());
  });
});

describe('쪽 밖 필기 막기', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };

  it('canvasPageAt: 점이 든 쪽 번호, 없으면 -1', () => {
    const rects = [rect, { x: 180, y: 0, w: 100, h: 100 }];
    expect(canvasPageAt(rects, 50, 50)).toBe(0);
    expect(canvasPageAt(rects, 200, 10)).toBe(1);
    expect(canvasPageAt(rects, 140, 50)).toBe(-1);
  });

  it('쪽 안 획은 그대로 남는다', () => {
    expect(clipStrokePoints([10, 10, 0.5, 20, 20, 0.5, 30, 10, 0.5], rect)).toEqual([[10, 10, 0.5, 20, 20, 0.5, 30, 10, 0.5]]);
  });

  it('점 하나(톡 찍기)도 쪽 안이면 남고, 밖이면 버린다', () => {
    expect(clipStrokePoints([5, 5, 0.5], rect)).toEqual([[5, 5, 0.5]]);
    expect(clipStrokePoints([-5, 5, 0.5], rect)).toEqual([]);
  });

  it('쪽 밖으로 나간 부분은 잘리고 경계까지 이어진다', () => {
    expect(clipStrokePoints([50, 50, 0.2, 150, 50, 0.6], rect)).toEqual([[50, 50, 0.2, 100, 50, 0.4]]);
  });

  it('나갔다 다시 들어오면 두 조각으로 나뉜다', () => {
    const parts = clipStrokePoints([50, 50, 0.5, 150, 50, 0.5, 150, 80, 0.5, 50, 80, 0.5], rect);
    expect(parts).toEqual([
      [50, 50, 0.5, 100, 50, 0.5],
      [100, 80, 0.5, 50, 80, 0.5],
    ]);
  });

  it('쪽을 스치고 지나가는 선분은 안쪽 구간만 남는다', () => {
    expect(clipStrokePoints([-50, 50, 0.5, 150, 50, 0.5], rect)).toEqual([[0, 50, 0.5, 100, 50, 0.5]]);
  });

  it('완전히 밖이면 아무것도 없다', () => {
    expect(clipStrokePoints([-50, -50, 0.5, -10, -20, 0.5], rect)).toEqual([]);
  });
});
