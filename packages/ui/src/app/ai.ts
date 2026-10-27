import { collectStream, resolveModelOptions, type AppState, type ProviderError, type ProviderId, type StreamRequest } from '@branch/core';
import { appStore, caps, registry } from './store';

/**
 * 채팅 밖 AI 도우미(스킬 작성·페이지 정리)에 쓸 provider.
 * - 웹·모바일: 채팅과 같이 PC로 보낸다(원격 Bridge). 에이전트·모델·노력치는 PC의 원격 설정이 정한다
 * - PC: 기본 provider, 준비되지 않았으면 대체 순서에서 준비된 것
 */
export function pickProvider({ settings, connections }: Pick<AppState, 'settings' | 'connections'>): ProviderId {
  if (!caps.localCli) return 'remote-bridge';
  const order = [settings.defaultProviderId, ...settings.fallbackOrder].filter((id) => caps.providers.includes(id) || id === 'mock');
  const ready = order.find((id) => connections[id]?.enabled && connections[id]?.status === 'ready');
  return ready ?? settings.defaultProviderId;
}

/** AI 한 번 부르기 실패 — 사용자에게 보일 문구를 담는다. 멈춘 경우 aborted */
export class AiError extends Error {
  constructor(
    message: string,
    readonly aborted = false,
  ) {
    super(message);
  }
}

/**
 * 고른 provider로 요청 하나를 끝까지 받는다. onDelta는 지금까지 받은 글 전체.
 * PC 연결 확인은 부르는 쪽이 한다 (usePcOnline은 훅이라)
 */
export async function runAi(providerId: ProviderId, req: StreamRequest, signal: AbortSignal, onDelta?: (text: string) => void): Promise<string> {
  const provider = registry.get(providerId);
  if (!provider) throw new AiError('쓸 수 있는 AI 연결이 없어요. 설정에서 연결을 확인하세요.');
  const r: StreamRequest = { ...req, signal };
  if (caps.modelChoice) Object.assign(r, resolveModelOptions(providerId, undefined, appStore.getState().connections[providerId]));
  try {
    const text = await collectStream(provider, r, (t) => {
      if (!signal.aborted) onDelta?.(t);
    });
    if (signal.aborted) throw new AiError('', true);
    return text;
  } catch (e) {
    if (e instanceof AiError) throw e;
    const err = e as Partial<ProviderError>;
    if (err?.code === 'aborted' || signal.aborted) throw new AiError('', true);
    throw new AiError(err?.message ?? 'AI 응답을 받지 못했어요.');
  }
}
