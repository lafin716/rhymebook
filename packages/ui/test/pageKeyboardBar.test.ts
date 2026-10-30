import { describe, expect, it } from 'vitest';
import { ownsKeyboard } from '../src/chat/pageEditorBridge';

describe('ownsKeyboard', () => {
  const content = { contains: (n: Node | null) => n === inside } as Pick<Node, 'contains'>;
  const inside = { id: 'cm-line' } as unknown as Element;
  const composer = { id: 'composer' } as unknown as Element;

  it('편집기 안에 포커스가 있으면 단축키 바를 띄운다', () => {
    expect(ownsKeyboard(content, inside)).toBe(true);
  });

  it('다른 입력창(가지 시트의 메시지 입력)이 키보드를 열면 띄우지 않는다', () => {
    expect(ownsKeyboard(content, composer)).toBe(false);
    expect(ownsKeyboard(content, null)).toBe(false);
  });
});
