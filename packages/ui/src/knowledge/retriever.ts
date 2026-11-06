import type { RetrievalRequest, RetrievalResult, RetrievalService, SourceView } from '@branch/core';
import { knowledgeApi } from './api';

let seq = 0;
const nextRequestId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * 지식베이스 검색 서비스 (core 스토어의 retriever 옵션에 넣는다).
 * 호출 시점에 knowledgeApi()를 읽어서 데스크톱 bridge나 개발용 가짜 API 모두 받는다.
 * API가 없으면 "unavailable"로 던지고, 스토어는 근거 없이 답변을 이어 간다.
 *
 * 취소 (R-07): 요청마다 requestId를 붙이고, signal이 끊기면 cancelRetrieve로 main→worker까지 중단을 알린 뒤
 * 바로 'aborted'로 거부한다. 늦게 도착한 결과는 버린다.
 */
export const knowledgeRetriever: RetrievalService = {
  retrieve(req: RetrievalRequest, signal?: AbortSignal): Promise<RetrievalResult> {
    const api = knowledgeApi();
    if (!api?.retrieve) return Promise.reject(new Error('unavailable'));
    if (signal?.aborted) return Promise.reject(new Error('aborted'));
    const requestId = nextRequestId();
    const call = api.retrieve(req, requestId);
    if (!signal) return call;
    return new Promise<RetrievalResult>((resolve, reject) => {
      const onAbort = () => {
        void api.cancelRetrieve?.(requestId).catch(() => {});
        reject(new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      call.then(
        (r) => {
          signal.removeEventListener('abort', onAbort);
          if (!signal.aborted) resolve(r);
        },
        (e: unknown) => {
          signal.removeEventListener('abort', onAbort);
          if (!signal.aborted) reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  },
  source(kbId: string, chunkId: string): Promise<SourceView> {
    const api = knowledgeApi();
    if (!api?.source) return Promise.reject(new Error('unavailable'));
    return api.source(kbId, chunkId);
  },
};
