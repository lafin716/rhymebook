import type { RetrievalRequest, RetrievalResult, RetrievalService, SourceView } from '@branch/core';
import { knowledgeApi } from './api';

/**
 * 지식베이스 검색 서비스 (core 스토어의 retriever 옵션에 넣는다).
 * 호출 시점에 knowledgeApi()를 읽어서 데스크톱 bridge나 개발용 가짜 API 모두 받는다.
 * API가 없으면 "unavailable"로 던지고, 스토어는 근거 없이 답변을 이어 간다.
 */
export const knowledgeRetriever: RetrievalService = {
  retrieve(req: RetrievalRequest): Promise<RetrievalResult> {
    const api = knowledgeApi();
    if (!api?.retrieve) return Promise.reject(new Error('unavailable'));
    return api.retrieve(req);
  },
  source(kbId: string, chunkId: string): Promise<SourceView> {
    const api = knowledgeApi();
    if (!api?.source) return Promise.reject(new Error('unavailable'));
    return api.source(kbId, chunkId);
  },
};
