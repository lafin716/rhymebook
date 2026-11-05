/**
 * 지식베이스 색인·검색 worker 엔트리 (ADR-113). build.mjs가 dist/ragWorker.cjs로 번들한다.
 * 실제 처리(SQLite·파싱·임베딩)는 bridge의 worker 구현이 맡는다. 여기서는 연결만 한다.
 */
import { runIndexerWorker } from '@branch/bridge';

runIndexerWorker();
