import { describe, expect, it } from 'vitest';
import { buildAnkiDeck, buildStudyNotes, collectStudyCards, studyNotesFileName } from '../src/notes';
import { createSeed } from '../src/seed';
import type { Session } from '../src/model';

const NOW = new Date(2026, 9, 10, 12).getTime();

function seedRoot() {
  const { sessions, messages } = createSeed(0);
  const root = Object.values(sessions).find((s) => s.parentId === null && Object.values(sessions).some((c) => c.parentId === s.id))!;
  return { sessions, messages, root };
}

describe('이해 노트', () => {
  it('가지를 DFS 순서로 계층 번호·경로·앵커 문맥과 함께 모은다', () => {
    const { sessions, messages, root } = seedRoot();
    const cards = collectStudyCards(sessions, messages, root.id);
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(cards[0]!.number).toBe('1');
    expect(cards[0]!.path).toEqual([root.title]);
    // 3단계 깊이 가지: 번호와 경로가 부모를 따른다
    const deep = cards.find((c) => c.depth === 3)!;
    expect(deep.number.split('.')).toHaveLength(3);
    expect(deep.path).toHaveLength(3);
    const parent = cards.find((c) => c.number === deep.number.split('.').slice(0, 2).join('.'))!;
    expect(deep.path[2]).toBe(parent.title);
    for (const c of cards) {
      expect(c.context?.text, c.title).toBe(c.anchorText);
    }
    expect(cards.filter((c) => c.summary)).toHaveLength(2);
  });

  it('Markdown 노트: 제목·통계·인용·요약/요약 없음 안내', () => {
    const { sessions, messages, root } = seedRoot();
    const md = buildStudyNotes(sessions, messages, root.id, { now: NOW });
    expect(md.startsWith(`# ${root.title}\n\n> octobooks 이해 노트 · 2026-10-10 · 가지 `)).toBe(true);
    expect(md).toMatch(/· 요약 2개/);
    expect(md).toContain('## 1. ');
    expect(md).toMatch(/\n#### \d+\.\d+\.\d+\. /);
    expect(md).toContain(`경로: ${root.title} › `);
    expect(md).toContain('**이해한 내용** — 내적은 같은 위치끼리');
    expect(md).toContain('_요약 없음');
    expect(md).toMatch(/\n> .*\*\*.+\*\*/);
  });

  it('가지가 없거나 없는 세션이면 안내 문구 / 빈 문자열', () => {
    const lone: Session = { id: 'x', parentId: null, rootId: 'x', title: '혼자', createdAt: 1, updatedAt: 1 };
    expect(buildStudyNotes({ x: lone }, {}, 'x', { now: NOW })).toContain('아직 가지가 없습니다');
    expect(buildStudyNotes({}, {}, 'x')).toBe('');
    expect(buildAnkiDeck({ x: lone }, {}, 'x').count).toBe(0);
  });

  it('Anki TSV: 헤더, 요약 있는 가지만, 칸마다 탭·줄바꿈 없이 HTML 이스케이프', () => {
    const { sessions, messages, root } = seedRoot();
    const target = Object.values(sessions).find((s) => s.summary)!;
    sessions[target.id] = { ...target, summary: '줄1\n줄2\t<b>&' };
    const { text, count } = buildAnkiDeck(sessions, messages, root.id);
    const lines = text.trimEnd().split('\n');
    expect(lines.slice(0, 4)).toEqual([
      '#separator:tab',
      '#html:true',
      `#deck:rhymebook::${root.title.replace(/[\t:]/g, ' ')}`,
      '#tags column:3',
    ]);
    expect(count).toBe(2);
    const rows = lines.slice(4);
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.split('\t')).toHaveLength(3);
    const edited = rows.find((r) => r.includes('줄1'))!;
    expect(edited.split('\t')[1]).toBe('줄1<br>줄2 &lt;b&gt;&amp;');
    expect(edited.split('\t')[0]).toMatch(/^<b>.+<\/b><br><small>.*<u>.+<\/u>/);
    expect(edited.split('\t')[2]).toMatch(/^branch-learn \S+$/);
  });

  it('파일 이름에서 위험 문자를 지운다', () => {
    expect(studyNotesFileName('a/b: "c"?', 'md', NOW)).toBe('ab c-이해노트-2026-10-10.md');
    expect(studyNotesFileName('  ', 'txt', NOW)).toBe('이해 노트-이해노트-2026-10-10.txt');
  });
});
