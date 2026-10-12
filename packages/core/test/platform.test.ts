import { describe, expect, it } from 'vitest';
import type { BridgeClientMsg } from '../src/bridge/protocol';
import { applyHostPolicy, isHostPolicy, orderForPlatform, platformCaps } from '../src/platform';

const start = (over: Partial<Extract<BridgeClientMsg, { type: 'chat.start' }>> = {}): BridgeClientMsg => ({
  type: 'chat.start',
  reqId: 'r1',
  providerId: 'claude-cli',
  system: 's',
  messages: [{ role: 'user', content: 'q' }],
  ...over,
});

describe('platformCaps', () => {
  it('데스크톱만 CLI 직접 실행·모델 선택·호스트 페어링', () => {
    const d = platformCaps('desktop');
    expect(d).toMatchObject({ localCli: true, modelChoice: true, hostPairing: true });
    expect(d.providers).toContain('claude-cli');
    for (const kind of ['web', 'mobile'] as const) {
      const c = platformCaps(kind);
      expect(c).toMatchObject({ localCli: false, modelChoice: false, hostPairing: false });
      expect(c.providers).not.toContain('claude-cli');
      expect(c.providers).not.toContain('codex-cli');
      expect(c.providers[0]).toBe('remote-bridge');
    }
  });

  it('호스트 기능이 없는 데스크톱 빌드', () => {
    expect(platformCaps('desktop', { hostPairing: false }).hostPairing).toBe(false);
  });

  it('저장된 대체 순서를 플랫폼 provider로 정리 (데모 Mock은 빠진다)', () => {
    const web = platformCaps('web');
    expect(orderForPlatform(['anthropic-api', 'claude-cli', 'openai-api', 'codex-cli', 'mock'], web)).toEqual([
      'anthropic-api',
      'openai-api',
      'remote-bridge',
    ]);
    for (const kind of ['desktop', 'web', 'mobile'] as const) expect(platformCaps(kind).providers).not.toContain('mock');
  });
});

describe('applyHostPolicy', () => {
  it('정책이 없으면 그대로', () => {
    const m = start({ model: 'opus' });
    expect(applyHostPolicy(m, null)).toBe(m);
  });

  it('원격이 보낸 모델·노력치를 버리고 PC 기본값으로', () => {
    const out = applyHostPolicy(start({ model: 'haiku', effort: 'max' }), {
      agent: 'auto',
      options: { 'claude-cli': { model: 'sonnet', effort: 'high' } },
    });
    expect(out).toMatchObject({ providerId: 'claude-cli', model: 'sonnet', effort: 'high' });
  });

  it('PC 기본값이 없으면 CLI 기본 (모델·노력치 없음)', () => {
    const out = applyHostPolicy(start({ model: 'haiku', effort: 'max' }), { agent: 'auto', options: {} });
    expect(out).not.toHaveProperty('model');
    expect(out).not.toHaveProperty('effort');
  });

  it('PC가 고른 에이전트로 바꾼다', () => {
    const out = applyHostPolicy(start(), { agent: 'codex-cli', options: { 'codex-cli': { model: 'gpt-6-luna', effort: 'ultra' } } });
    // luna는 ultra를 지원하지 않아 노력치는 버린다
    expect(out).toMatchObject({ providerId: 'codex-cli', model: 'gpt-6-luna' });
    expect(out).not.toHaveProperty('effort');
  });

  it('잘못된 모델 이름은 넘기지 않는다', () => {
    const out = applyHostPolicy(start(), { agent: 'auto', options: { 'claude-cli': { model: '--evil' } } });
    expect(out).not.toHaveProperty('model');
  });

  it('chat.start 외 메시지는 그대로', () => {
    const m: BridgeClientMsg = { type: 'status.get', reqId: 'x' };
    expect(applyHostPolicy(m, { agent: 'codex-cli', options: {} })).toBe(m);
  });
});

describe('isHostPolicy', () => {
  it('형식 검증', () => {
    expect(isHostPolicy({ agent: 'auto', options: {} })).toBe(true);
    expect(isHostPolicy({ agent: 'claude-cli', options: { 'claude-cli': { model: 'opus' } } })).toBe(true);
    expect(isHostPolicy({ agent: 'gpt', options: {} })).toBe(false);
    expect(isHostPolicy({ agent: 'auto', options: { mock: {} } })).toBe(false);
    expect(isHostPolicy({ agent: 'auto', options: { 'claude-cli': { model: 1 } } })).toBe(false);
  });
});
