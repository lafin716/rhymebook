import { t } from '../i18n';
import type { ChatTurn } from '../provider';

const roleLabel = (role: ChatTurn['role']): string => (role === 'user' ? t('core.bridgePrompt.learner') : t('core.bridgePrompt.tutor'));

/**
 * 무상태 CLI 실행용 프롬프트. CLI 세션 재개를 쓰지 않으므로 앱이 가진 대화를 한 번에 넘긴다.
 * - 메시지가 하나면 그대로
 * - 여러 개면 이전 대화를 기록으로 감싸고 마지막 학습자 메시지에 답하게 한다
 */
export function cliPrompt(messages: readonly ChatTurn[]): string {
  const turns = messages.filter((m) => m.content.trim());
  if (turns.length === 0) return '';
  const last = turns.at(-1)!;
  if (turns.length === 1) return last.content;
  const history = turns
    .slice(0, -1)
    .map((m) => `[${roleLabel(m.role)}]\n${m.content.trim()}`)
    .join('\n\n');
  return [
    '<conversation>',
    history,
    '</conversation>',
    '',
    t('core.bridgePrompt.answer'),
    '',
    last.content,
  ].join('\n');
}

/** system 지시를 따로 넘길 수 없는 CLI(Codex)용: 지시를 프롬프트 앞에 붙인다 */
export function withInstructions(system: string, prompt: string): string {
  if (!system.trim()) return prompt;
  return `<instructions>\n${system.trim()}\n</instructions>\n\n${prompt}`;
}
