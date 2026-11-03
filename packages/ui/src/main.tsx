// 언어를 가장 먼저 정한다 (ADR-105): 다른 모듈이 문구를 만들기 전에
import './i18n/init';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { remoteMode } from './app/capabilities';
import { restoreLastPage } from './app/lastPage';
import { isDemo, mobile, presentWindowId, sessionWindowId } from './app/runtime';
import { actions, db } from './app/store';
import { initRemoteSettings, startData } from './app/sync';
import { useUi } from './app/uiState';
import { initialThemePref } from './app/useTheme';
import { startBackupService } from './backup/service';
import { loadSkills } from './skills/skillsStore';
import { useLocale } from './i18n';
import { startScheduleService } from './schedules/store';
import { startNotificationService } from './notifications/service';
import { SessionWindowApp } from './window/SessionWindowApp';
import { PresentAudienceApp } from './window/PresentAudienceApp';
import { startUnreadTracker } from './session/unread';
import './styles.css';

async function boot() {
  initRemoteSettings();
  await startData();
  // 세션 창과 발표 청중 창은 최소한의 초기화만 한다
  if (!sessionWindowId && !presentWindowId) restoreLastPage();
  // 원격 모드는 이 기기에 데이터가 없으므로 백업도 PC에서만 한다
  if (!remoteMode) void startBackupService();
  // 스킬은 기기별 (원격 모드도 이 기기에 둔다). 데모 모드는 저장하지 않는다
  // 기본 스킬은 지금 언어로 넣으므로, 첫 실행 언어 창이 닫힌 뒤에 읽는다 (다른 언어를 고르면 다시 불러온 뒤 그 언어로)
  const startSkills = () => void loadSkills(isDemo() ? null : db);
  if (useLocale.getState().needsPrompt && !isDemo()) {
    const off = useLocale.subscribe((s) => {
      if (!s.needsPrompt) {
        off();
        startSkills();
      }
    });
  } else startSkills();
  if (!sessionWindowId && !presentWindowId) {
    startNotificationService();
    startUnreadTracker();
    void startScheduleService();
  }
  actions().updateSettings({ theme: initialThemePref() });
  // 모바일: 카메라로 PC의 QR을 스캔하면 branch://pair 링크로 앱이 열린다 → 페어링 폼에 채운다
  mobile?.onPairLink((uri) => {
    useUi.setState({ pairLink: uri });
    actions().setOverlay('settings');
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {/* 그리다 예외가 나도 빈 화면 대신 안내·다시 시도 */}
      <ErrorBoundary name="root" full>
        {presentWindowId ? (
          <PresentAudienceApp sessionId={presentWindowId} />
        ) : sessionWindowId ? (
          <SessionWindowApp />
        ) : (
          <App />
        )}
      </ErrorBoundary>
    </StrictMode>,
  );
}

void boot();
