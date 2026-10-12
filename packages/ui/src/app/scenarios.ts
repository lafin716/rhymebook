import { createSeed, defaultConnections, emptyView, mockControl, SEED_IDS } from '@branch/core';
import { useEffect } from 'react';
import { branchTarget } from '../chat/open';
import { selectText } from '../chat/selection';
import { useRuntime } from './runtime';
import { actions } from './store';
import { startData, suspendData } from './sync';
import { useUi } from './uiState';

/** 개발용 시나리오: 개발 서버에서 `#scenario=<id>` 해시로 실행한다 (화면에 데모 UI는 없음) */
export interface Scenario {
  id: string;
  label: string;
  hint: string;
  run(): void;
}

/** 시드 데이터와 목업 상태로 되돌린다 (테마는 유지) */
function reset(activeId: string | null = SEED_IDS.root) {
  if (!useRuntime.getState().demo) suspendData();
  useRuntime.getState().setDemo(true);
  mockControl.failNext = false;
  mockControl.speed = 1;
  mockControl.firstTokenDelay = 450;
  const theme = actions().settings.theme;
  actions().load({
    ...createSeed(),
    view: emptyView(activeId),
    connections: defaultConnections(),
  });
  actions().updateSettings({ theme });
  useUi.getState().setDrawer(false);
  window.getSelection()?.removeAllRanges();
}

/** 렌더 후 실행 (DOM 대상 시나리오) */
const afterPaint = (fn: () => void, delay = 120) => window.setTimeout(fn, delay);

export const SCENARIOS: Scenario[] = [
  { id: 'home', label: '홈', hint: '시드 세션 “트랜스포머 어텐션”', run: () => reset() },
  {
    id: 'empty',
    label: '빈 상태',
    hint: '새 학습 세션의 빈 화면과 추천 질문',
    run: () => {
      reset();
      actions().newRootSession();
    },
  },
  {
    id: 'branch-select',
    label: '선택→가지',
    hint: '답변의 “가중합”이 선택된 상태. 플로팅 액션에서 가지를 만든다',
    run: () => {
      reset();
      afterPaint(() => selectText('s-root-m2', '가중합'), 250);
    },
  },
  {
    id: 'deep',
    label: '3단계 가지',
    hint: '루트 › Q/K/V › 내적 › 코사인 유사도 (breadcrumb + 앵커 인용)',
    run: () => reset(SEED_IDS.cos),
  },
  {
    id: 'summary',
    label: '요약 되돌리기',
    hint: '“스케일링” 가지에서 요약 초안 생성 → 부모에 붙이기',
    run: () => {
      reset(SEED_IDS.scale);
      void actions().requestSummary(SEED_IDS.scale);
    },
  },
  {
    id: 'streaming',
    label: '스트리밍',
    hint: '느린 속도로 응답 생성 중 (중지 버튼)',
    run: () => {
      reset();
      mockControl.speed = 4;
      actions().sendMessage(SEED_IDS.root, '어텐션과 RNN의 차이는?');
    },
  },
  {
    id: 'error',
    label: '에러',
    hint: '응답 도중 스트림이 끊김 → 다시 시도',
    run: () => {
      reset();
      mockControl.failNext = true;
      actions().sendMessage(SEED_IDS.root, '셀프 어텐션과 크로스 어텐션의 차이는?');
    },
  },
  {
    id: 'offline',
    label: 'Provider 오프라인',
    hint: 'Claude CLI 오프라인 → 대체 provider 제안',
    run: () => {
      reset();
      actions().setSessionProvider(SEED_IDS.root, 'claude-cli');
      actions().setConnection('claude-cli', { status: 'offline', detail: 'bridge 응답 없음' });
      actions().sendMessage(SEED_IDS.root, '포지셔널 인코딩은 왜 필요해?');
    },
  },
  {
    id: 'split',
    label: '분할',
    hint: '루트 | Q/K/V | 내적 3패널 (모바일은 탭)',
    run: () => {
      reset();
      actions().openSession(SEED_IDS.qkv, 'split');
      actions().openSession(SEED_IDS.dot, 'split');
    },
  },
  {
    id: 'popup',
    label: '팝업/시트',
    hint: '가지를 플로팅 팝업으로 (모바일은 바텀시트)',
    run: () => {
      reset();
      const t = branchTarget() === 'sheet' ? 'sheet' : 'popup';
      actions().openSession(SEED_IDS.qkv, t);
      actions().openSession(SEED_IDS.softmax, t);
    },
  },
  {
    id: 'mindmap',
    label: '마인드맵',
    hint: '세션 트리. 클릭=열기, Shift+클릭=분할',
    run: () => {
      reset();
      actions().setMode('mindmap');
    },
  },
  {
    id: 'search',
    label: '검색',
    hint: '⌘K 세션 검색',
    run: () => {
      reset();
      actions().setOverlay('search');
    },
  },
  {
    id: 'settings',
    label: '설정',
    hint: '연결 카드, CLI 상태, API 키, 페어링 QR',
    run: () => {
      reset();
      actions().setOverlay('settings');
    },
  },
];

/** 데모 모드 종료: 저장된 실제 데이터와 provider로 돌아간다 (API 키는 탭 메모리에 남아 있으면 그대로 사용) */
export function exitDemo() {
  useRuntime.getState().setDemo(false);
  mockControl.failNext = false;
  window.getSelection()?.removeAllRanges();
  void startData();
}

export function runScenario(id: string): boolean {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) return false;
  s.run();
  return true;
}

/**
 * 개발 서버 전용: `#scenario=<id>` 해시로 시나리오를 실행한다 (화면 UI 없음, E2E·스크린샷용).
 * 해시를 지우면 실제 데이터로 돌아간다.
 */
export function useScenarioHash() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const apply = () => {
      const id = /scenario=([\w-]+)/.exec(window.location.hash)?.[1];
      if (id) runScenario(id);
      else if (useRuntime.getState().demo) exitDemo();
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);
}
