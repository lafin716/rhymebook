import { t } from '../i18n';
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
  { id: 'home', get label() { return t('app.scenarios.home.label'); }, get hint() { return t('app.scenarios.home.hint'); }, run: () => reset() },
  {
    id: 'empty',
    get label() { return t('app.scenarios.empty.label'); },
    get hint() { return t('app.scenarios.empty.hint'); },
    run: () => {
      reset();
      actions().newRootSession();
    },
  },
  {
    id: 'branch-select',
    get label() { return t('app.scenarios.branch-select.label'); },
    get hint() { return t('app.scenarios.branch-select.hint'); },
    run: () => {
      reset();
      afterPaint(() => selectText('s-root-m2', '가중합'), 250);
    },
  },
  {
    id: 'deep',
    get label() { return t('app.scenarios.deep.label'); },
    get hint() { return t('app.scenarios.deep.hint'); },
    run: () => reset(SEED_IDS.cos),
  },
  {
    id: 'summary',
    get label() { return t('app.scenarios.summary.label'); },
    get hint() { return t('app.scenarios.summary.hint'); },
    run: () => {
      reset(SEED_IDS.scale);
      void actions().requestSummary(SEED_IDS.scale);
    },
  },
  {
    id: 'streaming',
    get label() { return t('app.scenarios.streaming.label'); },
    get hint() { return t('app.scenarios.streaming.hint'); },
    run: () => {
      reset();
      mockControl.speed = 4;
      actions().sendMessage(SEED_IDS.root, '어텐션과 RNN의 차이는?');
    },
  },
  {
    id: 'error',
    get label() { return t('app.scenarios.error.label'); },
    get hint() { return t('app.scenarios.error.hint'); },
    run: () => {
      reset();
      mockControl.failNext = true;
      actions().sendMessage(SEED_IDS.root, '셀프 어텐션과 크로스 어텐션의 차이는?');
    },
  },
  {
    id: 'offline',
    get label() { return t('app.scenarios.offline.label'); },
    get hint() { return t('app.scenarios.offline.hint'); },
    run: () => {
      reset();
      actions().setSessionProvider(SEED_IDS.root, 'claude-cli');
      actions().setConnection('claude-cli', { status: 'offline', detail: 'bridge 응답 없음' });
      actions().sendMessage(SEED_IDS.root, '포지셔널 인코딩은 왜 필요해?');
    },
  },
  {
    id: 'split',
    get label() { return t('app.scenarios.split.label'); },
    get hint() { return t('app.scenarios.split.hint'); },
    run: () => {
      reset();
      actions().openSession(SEED_IDS.qkv, 'split');
      actions().openSession(SEED_IDS.dot, 'split');
    },
  },
  {
    id: 'popup',
    get label() { return t('app.scenarios.popup.label'); },
    get hint() { return t('app.scenarios.popup.hint'); },
    run: () => {
      reset();
      const t = branchTarget() === 'sheet' ? 'sheet' : 'popup';
      actions().openSession(SEED_IDS.qkv, t);
      actions().openSession(SEED_IDS.softmax, t);
    },
  },
  {
    id: 'mindmap',
    get label() { return t('app.scenarios.mindmap.label'); },
    get hint() { return t('app.scenarios.mindmap.hint'); },
    run: () => {
      reset();
      actions().setMode('mindmap');
    },
  },
  {
    id: 'search',
    get label() { return t('app.scenarios.search.label'); },
    get hint() { return t('app.scenarios.search.hint'); },
    run: () => {
      reset();
      actions().setOverlay('search');
    },
  },
  {
    id: 'settings',
    get label() { return t('app.scenarios.settings.label'); },
    get hint() { return t('app.scenarios.settings.hint'); },
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
