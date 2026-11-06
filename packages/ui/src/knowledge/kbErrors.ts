import type { MessageKey } from '../i18n';

/**
 * 지식베이스 IPC 가드 오류 해석 (apps/desktop/src/kbGuard.ts).
 * main은 정책 위반을 `kb-guard:<code>: <개발자용 설명>`, 인자 검증 실패를 `kb-arg:<field>`로 보낸다.
 * Electron은 여기에 `Error invoking remote method '...': Error: ` 접두어를 붙이므로 메시지 어디서든 찾는다.
 */
export type KbGuardCode = 'codebase_index_forbidden' | 'linked_kind_locked' | 'folder_not_allowed' | 'kb_meta_unreadable';

export type KbErrorCode = KbGuardCode | 'arg';

const GUARD_CODES: readonly KbGuardCode[] = [
  'codebase_index_forbidden',
  'linked_kind_locked',
  'folder_not_allowed',
  'kb_meta_unreadable',
];

// 가드 코드는 소문자, 인자 필드는 kbId·kbPath처럼 대문자를 포함할 수 있다
const MARK = /(?:^|[\s:])kb-(guard|arg):([A-Za-z_.]+)/;

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return '';
}

/** IPC 오류에서 가드 코드를 꺼낸다. 알 수 없는 코드거나 가드 오류가 아니면 null */
export function parseKbError(e: unknown): KbErrorCode | null {
  const m = MARK.exec(rawMessage(e));
  if (!m) return null;
  if (m[1] === 'arg') return 'arg';
  const code = (GUARD_CODES as readonly string[]).includes(m[2] ?? '') ? (m[2] as KbGuardCode) : null;
  return code;
}

/** `kb-arg:<field>`의 필드 이름 (예: kbId). 인자 오류가 아니면 null */
export function kbArgField(e: unknown): string | null {
  const m = MARK.exec(rawMessage(e));
  return m?.[1] === 'arg' ? (m[2] ?? null) : null;
}

/** 코드별 원인·해결 문구 키. 키를 리터럴로 적어 MessageKey 검사를 받는다 */
const GUIDE: Record<KbErrorCode, { cause: MessageKey; fix: MessageKey }> = {
  codebase_index_forbidden: {
    cause: 'knowledge.guard.codebase_index_forbidden.cause',
    fix: 'knowledge.guard.codebase_index_forbidden.fix',
  },
  linked_kind_locked: {
    cause: 'knowledge.guard.linked_kind_locked.cause',
    fix: 'knowledge.guard.linked_kind_locked.fix',
  },
  folder_not_allowed: {
    cause: 'knowledge.guard.folder_not_allowed.cause',
    fix: 'knowledge.guard.folder_not_allowed.fix',
  },
  kb_meta_unreadable: {
    cause: 'knowledge.guard.kb_meta_unreadable.cause',
    fix: 'knowledge.guard.kb_meta_unreadable.fix',
  },
  arg: {
    cause: 'knowledge.guard.arg.cause',
    fix: 'knowledge.guard.arg.fix',
  },
};

/** 가드 오류면 "원인 해결" 문구를, 아니면 null */
export function kbErrorGuide(e: unknown, t: (key: MessageKey) => string): string | null {
  const code = parseKbError(e);
  if (!code) return null;
  const k = GUIDE[code];
  return `${t(k.cause)} ${t(k.fix)}`;
}

/** 가드 오류면 원인·해결을, 그 밖의 오류면 일반 실패 문구를 돌려준다 */
export function knowledgeErrorText(e: unknown, t: (key: MessageKey) => string): string {
  return kbErrorGuide(e, t) ?? t('knowledge.error.generic');
}
