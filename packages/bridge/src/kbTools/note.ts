import { KB_TOOLS_GUIDE, type RagMode } from '@branch/core';
import { KB_MCP_TOOL_PREFIX } from './config';

/** 심층(deep) 모드에서만 덧붙이는 문장: 비교·여러 단계 질문은 도구로 검증하게 한다 */
const DEEP_EXTRA =
  'This is deep mode: for comparisons or multi-step questions, verify each claim with the tools (search, then read the exact lines) before answering.';

/**
 * 답변 시스템 안내: 이번 답의 지식베이스 목록과 도구 사용법. Claude는 도구 이름에 접두어가 붙는다.
 * mode: 'fast'는 도구를 쓰지 않으므로 호출되지 않는다. 'deep'이면 검증 문장을 덧붙인다.
 */
export function kbToolsNote(
  kbs: { kbId: string; kbName: string }[],
  provider: 'claude-cli' | 'codex-cli',
  mode?: RagMode,
): string {
  // 이름의 제어 문자·줄바꿈·공백 연속은 한 칸으로: 이름으로 안내문에 줄을 끼워 넣지 못하게
  const list = kbs.map((k) => `- ${k.kbName.replace(/[\p{Cc}\s]+/gu, ' ').trim()} (kbId: ${k.kbId})`);
  const names = provider === 'claude-cli' ? `In this CLI the tool names are prefixed with ${KB_MCP_TOOL_PREFIX}.` : '';
  const deep = mode === 'deep' ? DEEP_EXTRA : '';
  return ['Knowledge bases for this answer:', ...list, KB_TOOLS_GUIDE, names, deep].filter(Boolean).join('\n');
}
