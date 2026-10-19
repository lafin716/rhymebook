import 'fake-indexeddb/auto';
import { defaultSkills, type Skill } from '@branch/core';
import { describe, expect, it } from 'vitest';
import { BranchDB } from '../src/persist/db';
import { dropHostSkills, loadSkills, pullSkillsFromPc, switchSkillHost, useSkills } from '../src/skills/skillsStore';

const skill = (name: string): Skill => ({ ...defaultSkills()[0]!, id: `k-${name}`, name, title: name, builtin: undefined });
const names = () => useSkills.getState().skills.map((s) => s.name).sort();

// 테스트 환경(node)은 웹과 같은 원격 모드라 PC별 목록을 쓴다 (ADR-064)
describe('PC별 스킬 목록', () => {
  it('예전 목록을 첫 PC로 옮기고, PC마다 따로 받고, 지운 PC의 목록을 지운다', async () => {
    const db = new BranchDB(`host-skills-${Math.random()}`);
    await db.skills.put(skill('legacy'));
    await loadSkills(db);

    await switchSkillHost('pc-a');
    expect(names()).toEqual(['legacy']);
    expect(await db.skills.count()).toBe(0);

    await pullSkillsFromPc(async () => [skill('a1')]);
    expect(names()).toEqual(['a1', 'legacy']);

    await switchSkillHost('pc-b');
    expect(names()).toEqual([]);
    useSkills.getState().save({ ...skill('b-local'), id: undefined });
    const r = await pullSkillsFromPc(async () => [skill('b1')]);
    expect(r.added).toBe(1);
    expect(names()).toEqual(['b-local', 'b1']);

    await switchSkillHost('pc-a');
    expect(names()).toEqual(['a1', 'legacy']);

    await dropHostSkills('pc-b');
    await switchSkillHost('pc-b');
    expect(names()).toEqual([]);

    await switchSkillHost(null);
    expect(names()).toEqual([]);
  });

  it('받는 사이 다른 PC로 바뀌면 받은 스킬을 버린다', async () => {
    let release!: (v: Skill[]) => void;
    const pending = pullSkillsFromPc(() => new Promise((r) => (release = r)));
    await switchSkillHost('pc-a');
    await new Promise((r) => setTimeout(r));
    await switchSkillHost('pc-c');
    release([skill('late')]);
    expect(await pending).toEqual({ added: 0, updated: 0, skipped: 0 });
    expect(names()).toEqual([]);
  });
});
