import { describe, expect, it } from 'vitest';
import { parseHostList, removeHost, upsertHost, withActiveHost, type RemotePairing } from '../src';

const host = (bridgeId: string, extra: Partial<RemotePairing> = {}): RemotePairing => ({
  url: `ws://${bridgeId}.example.ts.net:7381`,
  bridgeKey: `key-${bridgeId}`,
  bridgeId,
  bridgeName: `PC ${bridgeId}`,
  deviceId: 'dev',
  deviceSecret: 'secret',
  pairedAt: 1,
  trust: 'qr',
  ...extra,
});

describe('저장한 원격 PC 목록', () => {
  it('깨진 값과 모양이 다른 항목은 버린다', () => {
    expect(parseHostList(null)).toEqual([]);
    expect(parseHostList('not json')).toEqual([]);
    expect(parseHostList('{"a":1}')).toEqual([]);
    expect(parseHostList(JSON.stringify([host('a'), { url: 'x' }, null]))).toEqual([host('a')]);
  });

  it('새 PC는 뒤에 붙이고 같은 PC는 제자리에서 바꾼다', () => {
    const list = upsertHost(upsertHost([], host('a')), host('b'));
    expect(list.map((h) => h.bridgeId)).toEqual(['a', 'b']);
    const again = upsertHost(list, host('a', { bridgeName: '새 이름' }));
    expect(again.map((h) => h.bridgeName)).toEqual(['새 이름', 'PC b']);
  });

  it('bridgeId로 지운다', () => {
    expect(removeHost([host('a'), host('b')], 'a').map((h) => h.bridgeId)).toEqual(['b']);
  });

  it('목록에 없는 활성 페어링(이전 버전)을 앞에 넣는다', () => {
    expect(withActiveHost([host('b')], host('a')).map((h) => h.bridgeId)).toEqual(['a', 'b']);
    expect(withActiveHost([host('a')], host('a'))).toHaveLength(1);
    expect(withActiveHost([host('a')], null)).toHaveLength(1);
  });
});
