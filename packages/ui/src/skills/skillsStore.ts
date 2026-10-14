import {
  defaultSkills,
  diffSkillFolders,
  isSkill,
  mergeSkills,
  newId,
  normalizeSkillName,
  sanitizeSkillFiles,
  toSkillFolder,
  type ID,
  type Skill,
  type SkillFile,
  type SkillFolderFields,
} from '@branch/core';
import { create } from 'zustand';
import { actions } from '../app/store';
import { desktop, sessionWindowId } from '../app/runtime';
import type { BranchDB } from '../persist/db';

/**
 * 스킬 목록 (IMP-09, ADR-034). 기기별로 IndexedDB에 둔다(원격 모드 웹·모바일도 이 기기에).
 * 질문에는 보낸 시점의 사본(SkillRef)이 실리므로 PC가 같은 스킬을 몰라도 된다.
 * 처음 실행할 때 예시 스킬(커리큘럼 생성)을 한 번 넣고, 지운 예시는 다시 넣지 않는다.
 *
 * 데스크톱 메인 창은 스킬마다 폴더(`<userData>/skills/<name>/`)를 거울처럼 둔다 (IMP-12, ADR-038).
 * 앱에서 저장하면 폴더에 쓰고, 창으로 돌아오면 폴더에서 바뀐 내용·새 스킬 폴더를 읽어 온다.
 */
interface SkillsState {
  skills: Skill[];
  loaded: boolean;
  /**
   * 새로 만들거나 고친다 (id가 없으면 새 id). 저장한 스킬을 돌려준다.
   * removedFiles: 사용자가 편집 중에 뺀 파일 경로. 주지 않으면 저장 전 스킬에 있다가 빠진 파일
   */
  save(input: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID }, removedFiles?: string[]): Skill;
  remove(id: ID): void;
  /** 지운 예시 스킬을 다시 넣는다 */
  restoreDefaults(): void;
  /** 다음에 여는 스킬 관리 페이지를 '새 스킬 + AI 입력'으로 연다 (IMP-11) */
  aiIntent: boolean;
  /** aiIntent를 읽고 지운다 */
  takeAiIntent(): boolean;
}

let db: BranchDB | null = null;

/** 스킬 폴더를 쓰는 창: 데스크톱 메인 창만 (세션 창은 같은 DB를 읽기만) */
const folders = !sessionWindowId ? desktop?.skills : undefined;

const byTitle = (a: Skill, b: Skill) => a.title.localeCompare(b.title, 'ko');

function persist(fn: (db: BranchDB) => Promise<unknown>) {
  if (!db) return;
  fn(db).catch((e: unknown) => console.warn('[skills] 저장 실패', e));
}

/** 앱에서 지웠는데 폴더 삭제가 아직 끝나지 않은(또는 실패한) 이름: 동기화로 되살리지 않는다 */
const tombstones = new Set<string>();

/** removed: 앱에서 사용자가 뺀 파일 경로 (폴더에서는 이 파일만 지운다) */
function writeFolder(skill: Skill, prevName?: string, removed: string[] = []) {
  tombstones.delete(skill.name);
  folders
    ?.write(toSkillFolder(skill), { ...(prevName && prevName !== skill.name ? { prevName } : {}), ...(removed.length ? { removed } : {}) })
    .catch((e: unknown) => console.warn('[skills] 폴더 쓰기 실패', e));
}

const pathsOf = (files: readonly SkillFile[] = []) => new Set(files.map((f) => f.path.toLowerCase()));

/** 저장할 스킬 모양: 빈 파일 목록·옵션은 키를 두지 않는다 */
function build(input: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID }, prev: Skill | undefined, now: number): Skill {
  const files = sanitizeSkillFiles(input.files ?? []);
  return {
    id: prev?.id ?? input.id ?? newId('k'),
    name: input.name,
    title: input.title.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    ...(files.length ? { files } : {}),
    ...(input.options ? { options: input.options } : {}),
    ...(prev?.builtin || input.builtin ? { builtin: true } : {}),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
}

export const useSkills = create<SkillsState>((set, get) => ({
  skills: [],
  loaded: false,
  aiIntent: false,

  takeAiIntent() {
    const v = get().aiIntent;
    if (v) set({ aiIntent: false });
    return v;
  },

  save(input, removedFiles) {
    const prev = input.id ? get().skills.find((s) => s.id === input.id) : undefined;
    const skill = build(input, prev, Date.now());
    set((s) => ({ skills: [...s.skills.filter((x) => x.id !== skill.id), skill].sort(byTitle) }));
    persist((d) => d.skills.put(skill));
    // 지울 파일: 편집 화면이 알려 준 것, 아니면 저장 전에 있다가 빠진 것
    const kept = pathsOf(skill.files);
    const removed = removedFiles ?? (prev?.files ?? []).map((f) => f.path);
    writeFolder(skill, prev?.name, removed.filter((p) => !kept.has(p.toLowerCase())));
    return skill;
  },

  remove(id) {
    const gone = get().skills.find((x) => x.id === id);
    set((s) => ({ skills: s.skills.filter((x) => x.id !== id) }));
    persist((d) => d.skills.delete(id));
    if (gone && folders) {
      tombstones.add(gone.name);
      folders.remove(gone.name).catch((e: unknown) => console.warn('[skills] 폴더 삭제 실패', e));
    }
  },

  restoreDefaults() {
    const have = new Set(get().skills.map((s) => s.id));
    const names = new Set(get().skills.map((s) => s.name));
    const add = defaultSkills().filter((s) => !have.has(s.id) && !names.has(s.name));
    if (!add.length) return;
    set((s) => ({ skills: [...s.skills, ...add].sort(byTitle) }));
    persist((d) => d.skills.bulkPut(add));
    for (const s of add) writeFolder(s);
  },
}));

/** 폴더에서 읽은 내용을 앱에 반영한다 (폴더에 다시 쓰지 않는다) */
function applyFolder(fields: SkillFolderFields & { id?: ID }) {
  const prev = fields.id ? useSkills.getState().skills.find((s) => s.id === fields.id) : undefined;
  const skill = build(fields, prev, Date.now());
  useSkills.setState((s) => ({ skills: [...s.skills.filter((x) => x.id !== skill.id), skill].sort(byTitle) }));
  persist((d) => d.skills.put(skill));
}

let syncing: Promise<void> | null = null;

/**
 * 스킬 폴더와 맞춘다 (데스크톱 메인 창). 폴더에서 바뀐 스킬은 고치고, 앱에 없는 폴더는 새 스킬로 가져온다.
 * writeMissing이면 폴더가 없는 앱 스킬의 폴더를 만든다(시작 시 한 번).
 */
export function syncSkillFolders(writeMissing = false): Promise<void> {
  if (!folders) return Promise.resolve();
  syncing ??= (async () => {
    try {
      const list = await folders.readAll();
      // 삭제가 끝난 이름은 묘비에서 뺀다
      const present = new Set(list.map((f) => f.name.toLowerCase()));
      for (const n of tombstones) if (!present.has(n)) tombstones.delete(n);
      const { update, create } = diffSkillFolders(useSkills.getState().skills, list, tombstones);
      for (const u of update) applyFolder(u);
      for (const c of create) applyFolder(c);
      if (writeMissing) {
        const have = new Set(list.map((f) => normalizeSkillName(f.name)));
        for (const s of useSkills.getState().skills) if (!have.has(s.name)) writeFolder(s);
      }
    } catch (e) {
      console.warn('[skills] 폴더 읽기 실패', e);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/**
 * 웹·모바일: PC에서 만든 스킬을 받아 이 기기 스킬에 합친다 (명령 이름이 같으면 PC 내용으로).
 * 이 기기에만 있는 스킬은 지우지 않는다.
 */
export async function pullSkillsFromPc(pull: () => Promise<Skill[]>): Promise<{ added: number; updated: number; skipped: number }> {
  const incoming = (await pull()).filter(isSkill);
  const { skills, added, updated, skipped } = mergeSkills(useSkills.getState().skills, incoming, () => newId('k'));
  if (added || updated) {
    const before = new Map(useSkills.getState().skills.map((s) => [s.id, s]));
    const changed = skills.filter((s) => before.get(s.id) !== s);
    useSkills.setState({ skills: [...skills].sort(byTitle) });
    persist((d) => d.skills.bulkPut(changed));
  }
  return { added, updated, skipped };
}

/** 스킬 폴더를 OS 파일 탐색기로 연다. 스킬을 주지 않으면 스킬 폴더 루트 */
export function openSkillFolder(skill?: Skill): Promise<void> {
  if (!folders) return Promise.resolve();
  return folders.open(skill ? toSkillFolder(skill) : undefined);
}

export const skillFoldersAvailable = !!folders;
export const skillFoldersRoot = folders?.root ?? '';

/** 시작 시 한 번: 저장된 스킬을 읽고, 처음이면 예시 스킬을 넣는다. 저장소를 못 쓰면 메모리에서만 */
export async function loadSkills(database: BranchDB | null) {
  db = database;
  let skills: Skill[] = [];
  try {
    if (database) {
      skills = (await database.skills.toArray()).filter(isSkill);
      const seeded = await database.kv.get('skillsSeeded');
      if (!seeded) {
        const add = defaultSkills().filter((d) => !skills.some((s) => s.name === d.name));
        await database.transaction('rw', database.skills, database.kv, async () => {
          await database.skills.bulkPut(add);
          await database.kv.put({ key: 'skillsSeeded', value: true });
        });
        skills = [...skills, ...add];
      }
    } else skills = defaultSkills();
  } catch (e) {
    console.warn('[skills] 불러오기 실패, 이번 실행은 저장되지 않습니다', e);
    db = null;
    skills = defaultSkills();
  }
  useSkills.setState({ skills: skills.sort(byTitle), loaded: true });
  // 데모 모드(db 없음)는 폴더를 건드리지 않는다
  if (folders && db) {
    await syncSkillFolders(true);
    window.addEventListener('focus', () => void syncSkillFolders());
  }
}

/** 스킬 관리 페이지를 새 스킬 + AI 입력으로 연다 */
export function openSkillsWithAI() {
  useSkills.setState({ aiIntent: true });
  actions().setOverlay('skills');
}
