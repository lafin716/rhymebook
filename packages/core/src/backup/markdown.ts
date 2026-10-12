import type { Message, Session } from '../model';
import type { BackupData } from './snapshot';

/**
 * 사람이 읽는 마크다운 (GitHub 저장소에 backup.json과 함께 커밋).
 * 루트 세션마다 대화를 적고, 가지는 깊이에 따라 한 단계 낮은 제목으로 이어 적는다.
 */
export function backupToMarkdown(data: BackupData, at: number): string {
  const children = new Map<string | null, Session[]>();
  for (const s of data.sessions) {
    const list = children.get(s.parentId) ?? [];
    list.push(s);
    children.set(s.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const bySession = new Map<string, Message[]>();
  for (const m of data.messages) {
    const list = bySession.get(m.sessionId) ?? [];
    list.push(m);
    bySession.set(m.sessionId, list);
  }

  const out: string[] = [`# rhymebook 백업`, '', `${new Date(at).toISOString()} 기준. 복원은 앱의 설정 › 백업에서 backup JSON으로 하세요.`, ''];
  const roots = (children.get(null) ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  const write = (s: Session, depth: number) => {
    const level = Math.min(2 + depth, 6);
    out.push(`${'#'.repeat(level)} ${depth > 0 ? '↳ ' : ''}${s.title}`, '');
    if (s.anchor) out.push(`> 원문: "${oneLine(s.anchor.text)}"`, '');
    if (s.summary) out.push(`> **가지 요약**: ${oneLine(s.summary)}`, '');
    for (const m of bySession.get(s.id) ?? []) {
      if (m.role === 'user') out.push(`**나**: ${oneLine(m.content)}`, '');
      else out.push(m.content.trim(), '');
    }
    for (const c of children.get(s.id) ?? []) write(c, depth + 1);
  };
  for (const r of roots) write(r, 0);
  return out.join('\n');
}

const oneLine = (t: string) => t.replace(/\s+/g, ' ').trim();
