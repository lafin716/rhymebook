import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createAppStore, type AppStore } from '../src/store';
import { createDemoRegistry } from '../src/providers/demo';
import { createSeed, emptyView, SEED_IDS } from '../src/seed';
import {
  buildStudyDigest,
  buildStudyPack,
  collectStudy,
  planStudyImport,
  readStudyPack,
  studyPackFileName,
  studyPackFiles,
  StudyError,
  validateStudyBundle,
  type StudyBundle,
} from '../src/study';

const NOW = new Date(2026, 9, 15, 12).getTime();

function makeStore(withSeed = true) {
  const store: AppStore = createAppStore({
    registry: createDemoRegistry(() => store.getState().connections),
    initial: { ...(withSeed ? createSeed(0) : {}), view: emptyView(withSeed ? SEED_IDS.root : null) },
  });
  return store;
}

function seedBundle(): StudyBundle {
  const { sessions, messages } = createSeed(0);
  return collectStudy({ sessions, messages, annotations: {} }, SEED_IDS.root, NOW)!;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof StudyError ? e.code : 'other';
  }
  return null;
};

describe('학습 꾸러미', () => {
  it('트리 순서로 세션·메시지를 모은다', () => {
    const b = seedBundle();
    expect(b.rootId).toBe(SEED_IDS.root);
    expect(b.sessions[0]!.id).toBe(SEED_IDS.root);
    expect(b.sessions.every((s) => s.rootId === SEED_IDS.root)).toBe(true);
    expect(b.sessions.length).toBeGreaterThan(1);
    expect(b.messages.every((m) => b.sessions.some((s) => s.id === m.sessionId))).toBe(true);
  });

  it('zip: README·세션 Markdown·study.json, 읽으면 같은 꾸러미', () => {
    const b = seedBundle();
    const files = studyPackFiles(b);
    const dir = files[0]!.path.split('/')[0];
    expect(files.map((f) => f.path)).toContain(`${dir}/README.md`);
    expect(files.map((f) => f.path)).toContain(`${dir}/study.json`);
    expect(files.filter((f) => f.path.endsWith('.md')).length).toBe(b.sessions.length + 1);
    const readme = files.find((f) => f.path.endsWith('README.md'))!.content;
    expect(readme).toContain('학습 가져오기');

    const zip = buildStudyPack(b);
    expect(Object.keys(unzipSync(zip))).toHaveLength(files.length);
    expect(readStudyPack(zip)).toEqual(clone(b));
    expect(studyPackFileName('어텐션/기초', NOW)).toMatch(/-학습-2026-10-15\.zip$/);
    expect(studyPackFileName('어텐션/기초', NOW)).not.toContain('/');
  });

  it('JSON(문자열·바이트·BOM)도 읽는다', () => {
    const b = seedBundle();
    const json = JSON.stringify(b);
    expect(readStudyPack(json)).toEqual(clone(b));
    expect(readStudyPack(strToU8(json))).toEqual(clone(b));
    expect(readStudyPack('﻿' + json)).toEqual(clone(b));
  });

  it('잘못된 꾸러미를 거부한다', () => {
    const b = seedBundle();
    expect(codeOf(() => readStudyPack('not json'))).toBe('invalid');
    expect(codeOf(() => readStudyPack(zipSync({ 'a/readme.md': strToU8('hi') })))).toBe('invalid');
    expect(codeOf(() => validateStudyBundle({ ...b, app: 'other' }))).toBe('invalid');
    expect(codeOf(() => validateStudyBundle({ ...b, version: 2 }))).toBe('newer-version');
    // 루트에서 닿지 않는 세션
    const orphan = clone(b);
    orphan.sessions.push({ ...orphan.sessions[1]!, id: 'orphan', parentId: 'nowhere' });
    expect(codeOf(() => validateStudyBundle(orphan))).toBe('invalid');
    // 다른 학습의 세션
    const foreign = clone(b);
    foreign.sessions[1] = { ...foreign.sessions[1]!, rootId: 'other' };
    expect(codeOf(() => validateStudyBundle(foreign))).toBe('invalid');
    // 꾸러미 밖 세션의 메시지
    const stray = clone(b);
    stray.messages.push({ ...stray.messages[0]!, id: 'm-stray', sessionId: 'nowhere' });
    expect(codeOf(() => validateStudyBundle(stray))).toBe('invalid');
    // 생성 중이던 메시지는 중지됨으로
    const live = clone(b);
    live.messages[1] = { ...live.messages[1]!, status: 'streaming' };
    expect(validateStudyBundle(live).messages[1]!.status).toBe('stopped');
  });
});

describe('학습 가져오기 계획', () => {
  it('없는 세션은 추가, 같으면 유지, 더 최근이면 갱신, 생성 중이면 건너뛴다', () => {
    const b = seedBundle();
    const empty = { sessions: {}, messages: {}, annotations: {} };
    expect(planStudyImport(empty, b)).toMatchObject({ added: b.sessions.length, updated: 0, kept: 0, skipped: 0 });

    const { sessions, messages } = createSeed(0);
    const local = { sessions, messages, annotations: {} };
    expect(planStudyImport(local, b)).toMatchObject({ added: 0, updated: 0, kept: b.sessions.length, apply: [] });

    const newer = clone(b);
    const target = newer.sessions[1]!;
    target.updatedAt = NOW;
    const plan = planStudyImport(local, newer);
    expect(plan).toMatchObject({ updated: 1, kept: b.sessions.length - 1, apply: [target.id] });

    // 이 기기가 더 최근이면 이 기기 것을 남긴다
    const older = clone(b);
    const localNewer = { ...local, sessions: { ...sessions, [target.id]: { ...sessions[target.id]!, updatedAt: NOW + 1 } } };
    older.sessions[1]!.updatedAt = NOW;
    expect(planStudyImport(localNewer, older).apply).toEqual([]);

    expect(planStudyImport(local, newer, { [target.id]: 'm-live' })).toMatchObject({ updated: 0, skipped: 1, apply: [] });
  });

  it('다른 학습과 id가 겹치면 conflict', () => {
    const b = seedBundle();
    const { sessions, messages } = createSeed(0);
    const id = b.sessions[1]!.id;
    const local = { sessions: { ...sessions, [id]: { ...sessions[id]!, rootId: 'other-root' } }, messages, annotations: {} };
    expect(codeOf(() => planStudyImport(local, b))).toBe('conflict');
    // 메시지 id가 다른 세션에 있음
    const moved = clone(b);
    const m = moved.messages.find((x) => x.sessionId === SEED_IDS.root)!;
    const other = moved.sessions.find((s) => s.id !== SEED_IDS.root)!;
    m.sessionId = other.id;
    expect(codeOf(() => planStudyImport({ sessions, messages, annotations: {} }, moved))).toBe('conflict');
  });
});

describe('스토어 importStudy', () => {
  it('빈 기기에 트리를 넣는다', () => {
    const store = makeStore(false);
    const b = seedBundle();
    expect(store.getState().importStudy(b)).toMatchObject({ added: b.sessions.length });
    const s = store.getState();
    expect(Object.keys(s.sessions).sort()).toEqual(b.sessions.map((x) => x.id).sort());
    for (const sess of b.sessions) expect(s.messages[sess.id]).toEqual(b.messages.filter((m) => m.sessionId === sess.id));
  });

  it('갱신하면 꾸러미에 없는 옛 메시지를 지우고, 이 기기에만 있는 가지는 남긴다', () => {
    const store = makeStore();
    const b = clone(seedBundle());
    const root = b.sessions[0]!;
    const rootMsgs = b.messages.filter((m) => m.sessionId === root.id);
    const dropped = rootMsgs.at(-1)!;
    // 루트에서 마지막 메시지를 지운 최신 버전 (가지가 그 메시지에 매달려 있지 않은 경우만)
    b.messages = b.messages.filter((m) => m.id !== dropped.id);
    root.updatedAt = NOW;
    // 이 기기에만 있는 가지: 꾸러미에서 뺀 잎 세션
    const leaf = b.sessions.find((s) => s.id !== root.id && !b.sessions.some((c) => c.parentId === s.id))!;
    b.sessions = b.sessions.filter((s) => s.id !== leaf.id);
    b.messages = b.messages.filter((m) => m.sessionId !== leaf.id);

    const r = store.getState().importStudy(validateStudyBundle(b));
    expect(r.updated).toBe(1);
    const s = store.getState();
    expect(s.messages[root.id]!.some((m) => m.id === dropped.id)).toBe(false);
    expect(s.sessions[root.id]!.updatedAt).toBe(NOW);
    expect(s.sessions[leaf.id]).toBeTruthy();
  });
});

describe('책 만들기 학습 원문', () => {
  it('제목·번호·질문·답변을 담고 한도를 넘으면 답변을 줄인다', () => {
    const b = seedBundle();
    const full = buildStudyDigest(b);
    expect(full).toContain(`# 학습 원문: ${b.title}`);
    expect(full).toContain('**Q.**');
    expect(full).toContain('**A.**');
    expect(full).not.toContain('(줄임)');

    const max = Math.floor(full.length / 2);
    const short = buildStudyDigest(b, max);
    expect(short.length).toBeLessThanOrEqual(max);
    expect(short).toContain('(줄임)');
    expect(short).toContain('앞부분만 담았다');
    expect(buildStudyDigest(b, 200).length).toBeLessThanOrEqual(200);
  });
});
