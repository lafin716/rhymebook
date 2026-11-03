import { describe, expect, it } from 'vitest';
import { ipcErrorMessage } from '../src/knowledge/api';

describe('ipcErrorMessage', () => {
  it('Electron IPC 접두어를 뗀다', () => {
    const e = new Error("Error invoking remote method 'knowledge:list': Error: 디스크 오류");
    expect(ipcErrorMessage(e)).toBe('디스크 오류');
  });
  it('접두어가 없으면 그대로 둔다', () => {
    expect(ipcErrorMessage(new Error('plain'))).toBe('plain');
  });
  it('Error가 아니면 빈 문자열', () => {
    expect(ipcErrorMessage({ message: 'x' })).toBe('');
  });
});
