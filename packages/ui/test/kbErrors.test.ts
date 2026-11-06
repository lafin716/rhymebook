import { describe, expect, it } from 'vitest';
import { kbArgField, kbErrorGuide, knowledgeErrorText, parseKbError } from '../src/knowledge/kbErrors';

// 테스트에서는 키를 그대로 돌려 주는 번역기를 쓴다 (실제 문구 검증은 locale 테스트 몫)
const echo = (key: string) => `[${key}]`;
const t = echo as Parameters<typeof kbErrorGuide>[1];

describe('parseKbError', () => {
  it('Electron 접두어가 붙은 kb-guard 코드를 꺼낸다', () => {
    const e = new Error(
      "Error invoking remote method 'knowledge:setKind': Error: kb-guard:linked_kind_locked: linked codebase kb1 cannot become a document knowledge base",
    );
    expect(parseKbError(e)).toBe('linked_kind_locked');
  });
  it('접두어 없는 메시지와 문자열도 읽는다', () => {
    expect(parseKbError(new Error('kb-guard:codebase_index_forbidden: reindex is not allowed'))).toBe('codebase_index_forbidden');
    expect(parseKbError('kb-guard:folder_not_allowed: x')).toBe('folder_not_allowed');
  });
  it('kb-arg 인자 오류는 모두 arg로 본다', () => {
    expect(parseKbError(new Error("Error invoking remote method 'knowledge:create': Error: kb-arg:linkedPath"))).toBe('arg');
    expect(parseKbError(new Error('kb-arg:reindex.paths'))).toBe('arg');
  });
  it('대문자가 든 인자 필드(kbId·kbPath·kbName)도 arg로 본다', () => {
    expect(parseKbError(new Error('kb-arg:kbId'))).toBe('arg');
    expect(parseKbError(new Error("Error invoking remote method 'x': Error: kb-arg:kbPath: 경로"))).toBe('arg');
  });
  it('kbArgField는 인자 필드 이름을 돌려준다', () => {
    expect(kbArgField(new Error('Error: kb-arg:kbName'))).toBe('kbName');
    expect(kbArgField(new Error('kb-guard:linked_kind_locked: x'))).toBeNull();
    expect(kbArgField(new Error('디스크 오류'))).toBeNull();
  });
  it('모르는 guard 코드나 가드가 아닌 오류는 null', () => {
    expect(parseKbError(new Error('kb-guard:made_up_code: x'))).toBeNull();
    expect(parseKbError(new Error('디스크 오류'))).toBeNull();
    expect(parseKbError({ message: 'kb-guard:folder_not_allowed: x' })).toBeNull();
    expect(parseKbError(undefined)).toBeNull();
  });
  it('단어 중간에 낀 표식은 무시한다', () => {
    expect(parseKbError(new Error('xkb-guard:folder_not_allowed: x'))).toBeNull();
  });
});

describe('kbErrorGuide', () => {
  it('가드 코드마다 원인과 해결 문구 키를 쓴다', () => {
    expect(kbErrorGuide(new Error('kb-guard:folder_not_allowed: x'), t)).toBe(
      '[knowledge.guard.folder_not_allowed.cause] [knowledge.guard.folder_not_allowed.fix]',
    );
    expect(kbErrorGuide(new Error('kb-arg:id'), t)).toBe('[knowledge.guard.arg.cause] [knowledge.guard.arg.fix]');
  });
  it('가드 오류가 아니면 null', () => {
    expect(kbErrorGuide(new Error('boom'), t)).toBeNull();
  });
});

describe('knowledgeErrorText', () => {
  it('가드 오류는 원인·해결 문구를 쓴다', () => {
    expect(knowledgeErrorText(new Error('kb-guard:kb_meta_unreadable: meta'), t)).toBe(
      '[knowledge.guard.kb_meta_unreadable.cause] [knowledge.guard.kb_meta_unreadable.fix]',
    );
  });
  it('kb-arg 인자 오류는 잘못된 입력 원인·해결 문구를 쓴다', () => {
    expect(knowledgeErrorText(new Error('Error: kb-arg:kbId'), t)).toBe('[knowledge.guard.arg.cause] [knowledge.guard.arg.fix]');
  });
  it('그 밖의 오류는 일반 실패 문구로 떨어진다', () => {
    expect(knowledgeErrorText(new Error('디스크 오류'), t)).toBe('[knowledge.error.generic]');
    expect(knowledgeErrorText(new Error('kb-guard:nope: x'), t)).toBe('[knowledge.error.generic]');
  });
});
