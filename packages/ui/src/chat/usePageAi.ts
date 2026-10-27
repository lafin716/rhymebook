import type { StreamRequest } from '@branch/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AiError, pickProvider, runAi } from '../app/ai';
import { caps, useApp } from '../app/store';
import { usePcOnline } from '../components/PcStatus';

export type PageAiKind = 'organize' | 'fill';

/**
 * 페이지 AI 도우미 실행 상태 (ADR-076). 한 번에 하나만 돌고, 멈출 수 있다.
 * run은 끝까지 받은 글을, 멈췄거나 실패하면 null을 돌려준다 (실패 문구는 error).
 */
export function usePageAi() {
  const providerId = useApp(pickProvider);
  const pcOnline = usePcOnline();
  const [busy, setBusy] = useState<PageAiKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const latest = useRef({ providerId, pcOnline });
  latest.current = { providerId, pcOnline };

  const run = useCallback(async (kind: PageAiKind, req: StreamRequest, onDelta?: (text: string) => void): Promise<string | null> => {
    if (ctrl.current) return null;
    const { providerId: pid, pcOnline: online } = latest.current;
    if (pid === 'remote-bridge' && !caps.localCli && !online) {
      setError('PC와 연결되어 있지 않아요. 먼저 PC에 연결하세요.');
      return null;
    }
    const c = new AbortController();
    ctrl.current = c;
    setBusy(kind);
    setError(null);
    try {
      return await runAi(pid, req, c.signal, onDelta);
    } catch (e) {
      if (!(e instanceof AiError && e.aborted)) setError(e instanceof Error && e.message ? e.message : 'AI 응답을 받지 못했어요.');
      return null;
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      setBusy(null);
    }
  }, []);

  const stop = useCallback(() => ctrl.current?.abort(), []);
  const clearError = useCallback(() => setError(null), []);

  return { busy, error, run, stop, clearError };
}

export type PageAi = ReturnType<typeof usePageAi>;
