import { defaultSkills, isSkill, newId, type ID, type Skill } from '@branch/core';
import { create } from 'zustand';
import type { BranchDB } from '../persist/db';

/**
 * 스킬 목록 (IMP-09, ADR-034). 기기별로 IndexedDB에 둔다(원격 모드 웹·모바일도 이 기기에).
 * 질문에는 보낸 시점의 사본(SkillRef)이 실리므로 PC가 같은 스킬을 몰라도 된다.
 * 처음 실행할 때 예시 스킬(커리큘럼 생성)을 한 번 넣고, 지운 예시는 다시 넣지 않는다.
 */
interface SkillsState {
  skills: Skill[];
  loaded: boolean;
  /** 새로 만들거나 고친다 (id가 없으면 새 id). 저장한 스킬을 돌려준다 */
  save(input: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID }): Skill;
  remove(id: ID): void;
  /** 지운 예시 스킬을 다시 넣는다 */
  restoreDefaults(): void;
}

let db: BranchDB | null = null;

const byTitle = (a: Skill, b: Skill) => a.title.localeCompare(b.title, 'ko');

function persist(fn: (db: BranchDB) => Promise<unknown>) {
  if (!db) return;
  fn(db).catch((e: unknown) => console.warn('[skills] 저장 실패', e));
}

export const useSkills = create<SkillsState>((set, get) => ({
  skills: [],
  loaded: false,

  save(input) {
    const now = Date.now();
    const prev = input.id ? get().skills.find((s) => s.id === input.id) : undefined;
    const skill: Skill = {
      id: prev?.id ?? newId('k'),
      name: input.name,
      title: input.title.trim(),
      description: input.description.trim(),
      prompt: input.prompt.trim(),
      ...(prev?.builtin ? { builtin: true } : {}),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    set((s) => ({ skills: [...s.skills.filter((x) => x.id !== skill.id), skill].sort(byTitle) }));
    persist((d) => d.skills.put(skill));
    return skill;
  },

  remove(id) {
    set((s) => ({ skills: s.skills.filter((x) => x.id !== id) }));
    persist((d) => d.skills.delete(id));
  },

  restoreDefaults() {
    const have = new Set(get().skills.map((s) => s.id));
    const names = new Set(get().skills.map((s) => s.name));
    const add = defaultSkills().filter((s) => !have.has(s.id) && !names.has(s.name));
    if (!add.length) return;
    set((s) => ({ skills: [...s.skills, ...add].sort(byTitle) }));
    persist((d) => d.skills.bulkPut(add));
  },
}));

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
}
