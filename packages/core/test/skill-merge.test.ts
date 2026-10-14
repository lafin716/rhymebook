import { describe, expect, it } from 'vitest';
import type { Skill } from '../src/model';
import { mergeSkills, SKILL_LIMITS } from '../src/skills';

const sk = (id: string, name: string, extra: Partial<Skill> = {}): Skill => ({
  id,
  name,
  title: name,
  description: '',
  prompt: `${name} 지시`,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

let n = 0;
const makeId = () => `new-${++n}`;

describe('mergeSkills (PC → 웹·모바일 스킬 동기화)', () => {
  it('adds PC-only skills, updates same-name skills with PC content, keeps device-only skills', () => {
    const local = [sk('a', 'mine'), sk('b', 'shared', { prompt: '옛 지시', createdAt: 5 })];
    const pc = [sk('pc-b', 'shared', { prompt: '새 지시', files: [{ path: 'references/x.md', content: 'x' }], updatedAt: 9 }), sk('pc-c', 'pconly')];
    const r = mergeSkills(local, pc, makeId);
    expect(r).toMatchObject({ added: 1, updated: 1, skipped: 0 });
    const byName = Object.fromEntries(r.skills.map((s) => [s.name, s]));
    expect(byName.mine).toBe(local[0]);
    // 이 기기 id·생성 시각은 유지, 내용은 PC
    expect(byName.shared).toMatchObject({ id: 'b', prompt: '새 지시', createdAt: 5, updatedAt: 9 });
    expect(byName.shared!.files).toHaveLength(1);
    expect(byName.pconly!.id).toBe('pc-c');
  });

  it('leaves identical skills untouched and gives a new id when the PC id is taken', () => {
    const local = [sk('same', 'curriculum'), sk('x', 'other')];
    const r = mergeSkills(local, [sk('pc', 'curriculum'), sk('x', 'clash')], makeId);
    expect(r).toMatchObject({ added: 1, updated: 0 });
    expect(r.skills[0]).toBe(local[0]);
    expect(r.skills.find((s) => s.name === 'clash')!.id).not.toBe('x');
  });

  it('drops a same-name skill options/files when the PC version has none', () => {
    const local = [sk('a', 'k', { files: [{ path: 'a.md', content: 'a' }], options: { providerId: 'claude-cli' } })];
    const r = mergeSkills(local, [sk('pc', 'k')], makeId);
    expect(r.skills[0]!.files).toBeUndefined();
    expect(r.skills[0]!.options).toBeUndefined();
  });

  it('does not take builtin marks or oversized descriptions from the PC', () => {
    const r = mergeSkills([], [sk('p', 'p', { builtin: true, description: 'd'.repeat(SKILL_LIMITS.description + 50) })], makeId);
    expect(r.skills[0]!.builtin).toBeUndefined();
    expect(r.skills[0]!.description).toHaveLength(SKILL_LIMITS.description);
  });

  it('does not exceed the skill count limit', () => {
    const local = Array.from({ length: SKILL_LIMITS.count - 1 }, (_, i) => sk(`l${i}`, `l${i}`));
    const r = mergeSkills(local, [sk('p1', 'p1'), sk('p2', 'p2')], makeId);
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    expect(r.skills).toHaveLength(SKILL_LIMITS.count);
  });
});
