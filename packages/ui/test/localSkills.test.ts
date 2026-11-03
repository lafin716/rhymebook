import 'fake-indexeddb/auto';
import { defaultSkills } from '@branch/core';
import { describe, expect, it, vi } from 'vitest';

// 모바일 자체 기기(로컬) 모드: PC별 목록이 아니라 이 기기 목록을 쓴다
vi.mock('../src/app/capabilities', async (orig) => ({ ...(await orig<object>()), remoteMode: false }));

const { BranchDB } = await import('../src/persist/db');
const { loadSkills, useSkills } = await import('../src/skills/skillsStore');

describe('로컬 프로필 기본 스킬 (ADR-106)', () => {
  it('PC별 목록으로 옮겨 비워진 기기 목록에도 데스크톱과 같은 기본 스킬을 다시 채운다', async () => {
    const db = new BranchDB(`local-skills-${Math.random()}`);
    const all = defaultSkills().map((s) => s.id).sort();
    // 예전 이전 작업: 기기 목록을 비우고 시드 기록만 남겼다
    await db.kv.put({ key: 'skillsSeeded', value: all });
    await db.kv.put({ key: 'hostSkillsMigrated', value: true });
    await loadSkills(db);
    expect(useSkills.getState().skills.map((s) => s.id).sort()).toEqual(all);
    expect((await db.kv.get('localSkillsSeeded'))?.value).toEqual(all);
  });
});
