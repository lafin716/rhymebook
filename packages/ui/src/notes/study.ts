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
import { t } from '../i18n';

/** 학습 꾸러미 내보내기·가져오기, 책으로 만들기 (ADR-043) */

const LOAD_TIMEOUT_MS = 20_000;

/** 가져오기 실패 코드(내부 id) → 안내 문구. 렌더 시점에 번역한다 */
function importFailMessages(): Record<string, string> {
  return {
    offline: t('notes.importFail.offline'),
    timeout: t('notes.importFail.timeout'),
    conflict: t('notes.importFail.conflict'),
    forbidden: t('notes.importFail.forbidden'),
    invalid: t('notes.importFail.invalid'),
    'rate-limit': t('notes.importFail.rateLimit'),
  };
}

/** 원격 기기: 트리 전체의 메시지를 PC에서 받아 올 때까지 기다린다. PC 앱은 바로 끝난다 */
async function loadTree(ids: readonly ID[]): Promise<void> {
  const c = syncClient;
  if (!c) return;
  const missing = () => ids.filter((id) => !c.state.getState().loaded[id]);
  if (!missing().length) return;
  if (c.state.getState().status !== 'online') throw new Error(importFailMessages().offline);
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
    const timer = setTimeout(() => finish(new Error(t('notes.study.loadTimeout'))), LOAD_TIMEOUT_MS);
    unsub = c.state.subscribe((s) => {
      if (s.status !== 'online') finish(new Error(importFailMessages().offline));
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
  if (!bundle) throw new Error(t('notes.study.notFound'));
  return bundle;
}

export async function exportStudy(rootId: ID): Promise<string> {
  const bundle = await collect(rootId);
  await saveBytesFile(studyPackFileName(bundle.title), buildStudyPack(bundle), 'application/zip');
  return t('notes.study.exported');
}

export async function importStudyFile(file: File): Promise<{ text: string; rootId: ID }> {
  if (file.size > STUDY_LIMITS.unzipBytes) throw new Error(t('notes.study.tooBig'));
  const bundle = readStudyPack(new Uint8Array(await file.arrayBuffer()));
  const name = t('notes.study.name', { title: bundle.title });
  if (syncClient) {
    try {
      await syncClient.importStudy(bundle);
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      throw new Error(importFailMessages()[code] ?? t('notes.study.importFailPc'), { cause: e });
    }
    return { text: t('notes.study.importedToPc', { name }), rootId: bundle.rootId };
  }
  const r = actions().importStudy(bundle);
  const parts = [
    t('notes.study.partAdded', { count: r.added }),
    t('notes.study.partUpdated', { count: r.updated }),
    t('notes.study.partKept', { count: r.kept }),
    ...(r.skipped ? [t('notes.study.partSkipped', { count: r.skipped })] : []),
  ];
  return { text: t('notes.study.imported', { name, parts: parts.join(' · ') }), rootId: bundle.rootId };
}

/** 새 루트 세션에서 /book 스킬로 이 학습을 책으로 엮는다. 만든 세션 id */
export async function makeBook(rootId: ID): Promise<ID> {
  const bundle = await collect(rootId);
  const digest = buildStudyDigest(bundle);
  const skills = useSkills.getState().skills;
  const book = skills.find((k) => k.id === BOOK_SKILL_ID) ?? skills.find((k) => k.name === 'book') ?? defaultSkills().find((k) => k.id === BOOK_SKILL_ID)!;
  const a = actions();
  const id = a.newRootSession();
  if (!id) throw new Error(t('notes.study.newSessionFail'));
  a.renameSession(id, t('notes.study.bookSessionTitle', { title: bundle.title }).slice(0, 200));
  const attachment: Attachment = {
    id: newId('f'),
    kind: 'text',
    name: t('notes.study.digestFileName', { title: bundle.title }).slice(0, 200),
    mime: 'text/markdown',
    size: new TextEncoder().encode(digest).length,
    data: digest,
  };
  if (!actions().sendMessage(id, t('notes.study.makeBookPrompt'), undefined, { attachments: [attachment], skill: skillRef(book) })) {
    throw new Error(t('notes.study.sendFail'));
  }
  return id;
}
