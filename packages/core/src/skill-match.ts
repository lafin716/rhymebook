import type { Skill } from './model';

/**
 * 채팅 요청에 맞는 스킬 고르기 (IMP-21, ADR-052).
 * 슬래시 명령 없이 보낸 질문이 어떤 스킬의 용도와 분명히 맞으면 그 스킬을 자동으로 쓴다.
 * 판단은 결정적 규칙만 쓴다 (질문마다 AI를 한 번 더 부르지 않는다):
 * - 기본 스킬: 이름별 의도 표현 (예: /quiz ← "퀴즈 내 줘", /speak ← "발음 들려 줘")
 * - 그 밖의 스킬: 질문에 스킬 제목이나 명령 이름이 그대로 들어 있을 때
 * 애매하면 고르지 않는다. 사용자는 입력창의 자동 칩을 빼서 끌 수 있다.
 */

const INTENTS: Record<string, RegExp> = {
  quiz: /퀴즈|quiz|(문제|시험)\s*(를|을)?\s*(좀\s*)?(내|만들어|출제)|확인\s*문제|테스트\s*해\s*(줘|주세요|봐)/i,
  speak: /소리\s*(내|로)|음성으로|발음\s*(을|좀)?\s*(들려|듣|알려|읽|해\s*(줘|주))|(?<!(이야기|얘기|설명|소식|경험|썰)\s*(를|을|좀)?\s*)들려\s*(줘|주세요|줄래|주라)|듣고\s*싶|낭독|읽어\s*(줘|주세요|줄래)[^\n]*(소리|음성|발음)|read\s+(it\s+)?(out\s+)?aloud|pronounc|say\s+it/i,
  curriculum: /커리큘럼|curriculum|로드맵|roadmap|학습\s*(계획|순서|경로)|공부\s*(계획|순서)/i,
  book: /책\s*(으로|처럼)\s*(만들|엮|정리|써)/,
};

const squash = (s: string) => s.normalize('NFC').toLowerCase().replace(/\s+/g, '');

function mentions(text: string, skill: Skill): boolean {
  const flat = squash(text);
  const title = squash(skill.title);
  if (title.length >= 3 && flat.includes(title)) return true;
  // 명령 이름은 단어로 나올 때만 (짧은 영문 이름이 다른 단어에 섞여 걸리지 않게)
  if (skill.name.length < 3) return false;
  const esc = skill.name.replace(/[-_]/g, (c) => `\\${c}`);
  return new RegExp(`(^|[^a-z0-9가-힣])${esc}($|[^a-z0-9가-힣_-])`, 'i').test(text);
}

/** 질문에 맞는 스킬. 없거나 슬래시 명령이면 null */
export function matchSkill(text: string, skills: readonly Skill[]): Skill | null {
  const t = text.trim();
  if (t.length < 2 || t.startsWith('/')) return null;
  // 의도 표현이 맞는 기본 스킬이 먼저, 그다음 제목·이름이 나온 스킬. 같은 순위면 질문에서 먼저 나온 것
  let best: { skill: Skill; rank: number; at: number } | null = null;
  for (const skill of skills) {
    const intent = INTENTS[skill.name];
    const m = intent?.exec(t);
    const hit = m ? { rank: 0, at: m.index } : mentions(t, skill) ? { rank: 1, at: 0 } : null;
    if (hit && (!best || hit.rank < best.rank || (hit.rank === best.rank && hit.at < best.at))) best = { skill, ...hit };
  }
  return best?.skill ?? null;
}
