import {
  BOOK_SKILL_ID,
  STUDY_LIMITS,
  buildStudyDigest,
  buildStudyPack,
  collectStudy,
  collectStudyCards,
  defaultSkills,
  newId,
  readStudyPack,
  skillRef,
  studyPackFileName,
  type Attachment,
  type ID,
} from '@branch/core';
import { actions } from '../app/store';
import { syncClient } from '../app/sync';
import { saveBytesFile } from '../lib/download';
import { useSkills } from '../skills/skillsStore';

/** 학습 꾸러미 내보내기·가져오기, 책으로 만들기 (ADR-043) */

const LOAD_TIMEOUT_MS = 20_000;

const IMPORT_FAIL: Record<string, string> = {
  offline: 'PC와 연결되어 있지 않아요. 연결된 뒤 다시 가져오세요.',
  timeout: 'PC가 응답하지 않아요. 잠시 후 다시 시도하세요.',
  conflict: '같은 id를 쓰는 다른 학습이 PC에 있어 가져오지 않았어요.',
  forbidden: '이미 있는 학습을 덮어쓰려면 PC 설정에서 원격 삭제를 허용해야 해요.',
  invalid: '이 파일은 원격으로 보내기에 너무 크거나 형식이 맞지 않아요. PC 앱에서 가져오세요.',
  'rate-limit': '요청이 너무 잦아요. 잠시 후 다시 시도하세요.',
};

/** 원격 기기: 트리 전체의 메시지를 PC에서 받아 올 때까지 기다린다. PC 앱은 바로 끝난다 */
async function loadTree(ids: readonly ID[]): Promise<void> {
  const c = syncClient;
  if (!c) return;
  const missing = () => ids.filter((id) => !c.state.getState().loaded[id]);
  if (!missing().length) return;
  if (c.state.getState().status !== 'online') throw new Error(IMPORT_FAIL.offline);
  for (const id of missing()) c.ensureMessages(id);
  await new Promise<void>((resolve, reject) => {
    let unsub = () => {};
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('PC에서 대화를 다 받지 못했어요. 잠시 후 다시 시도하세요.')), LOAD_TIMEOUT_MS);
    unsub = c.state.subscribe((s) => {
      if (s.status !== 'online') finish(new Error(IMPORT_FAIL.offline));
      else if (!missing().length) finish();
    });
    if (!missing().length) finish();
  });
}

/** 트리 전체(대화 포함)를 꾸러미로 모은다 */
async function collect(rootId: ID) {
  const s0 = actions();
  await loadTree([rootId, ...collectStudyCards(s0.sessions, s0.messages, rootId).map((c) => c.sessionId)]);
  const bundle = collectStudy(actions(), rootId);
  if (!bundle) throw new Error('학습을 찾지 못했어요.');
  return bundle;
}

export async function exportStudy(rootId: ID): Promise<string> {
  const bundle = await collect(rootId);
  await saveBytesFile(studyPackFileName(bundle.title), buildStudyPack(bundle), 'application/zip');
  return '학습 꾸러미(zip)를 저장했어요. 다른 기기의 이해 노트 › [학습 가져오기]로 불러오세요.';
}

export async function importStudyFile(file: File): Promise<{ text: string; rootId: ID }> {
  if (file.size > STUDY_LIMITS.unzipBytes) throw new Error('파일이 너무 커요.');
  const bundle = readStudyPack(new Uint8Array(await file.arrayBuffer()));
  const name = `“${bundle.title}”`;
  if (syncClient) {
    try {
      await syncClient.importStudy(bundle);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      throw new Error(IMPORT_FAIL[code] ?? 'PC에서 가져오지 못했어요.', { cause: e });
    }
    return { text: `${name} 학습을 PC로 가져왔어요.`, rootId: bundle.rootId };
  }
  const r = actions().importStudy(bundle);
  const parts = [`추가 ${r.added}`, `갱신 ${r.updated}`, `유지 ${r.kept}`, ...(r.skipped ? [`생성 중이라 건너뜀 ${r.skipped}`] : [])];
  return { text: `${name} 학습을 가져왔어요 — 가지 ${parts.join(' · ')}.`, rootId: bundle.rootId };
}

/** 새 루트 세션에서 /book 스킬로 이 학습을 책으로 엮는다. 만든 세션 id */
export async function makeBook(rootId: ID): Promise<ID> {
  const bundle = await collect(rootId);
  const digest = buildStudyDigest(bundle);
  const skills = useSkills.getState().skills;
  const book = skills.find((k) => k.id === BOOK_SKILL_ID) ?? skills.find((k) => k.name === 'book') ?? defaultSkills().find((k) => k.id === BOOK_SKILL_ID)!;
  const a = actions();
  const id = a.newRootSession();
  if (!id) throw new Error('새 세션을 만들지 못했어요.');
  a.renameSession(id, `📖 ${bundle.title}`.slice(0, 200));
  const attachment: Attachment = {
    id: newId('f'),
    kind: 'text',
    name: `${bundle.title} 학습 원문.md`.slice(0, 200),
    mime: 'text/markdown',
    size: new TextEncoder().encode(digest).length,
    data: digest,
  };
  if (!actions().sendMessage(id, '이 학습 기록을 책으로 만들어 줘.', undefined, { attachments: [attachment], skill: skillRef(book) })) {
    throw new Error('질문을 보내지 못했어요.');
  }
  return id;
}
