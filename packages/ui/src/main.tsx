import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { remoteMode } from './app/capabilities';
import { restoreLastPage } from './app/lastPage';
import { isDemo, mobile, presentWindowId, sessionWindowId } from './app/runtime';
import { actions, db } from './app/store';
import { initRemoteSettings, startData } from './app/sync';
import { useUi } from './app/uiState';
import { initialThemePref } from './app/useTheme';
import { startBackupService } from './backup/service';
import { loadSkills } from './skills/skillsStore';
import { SessionWindowApp } from './window/SessionWindowApp';
import { PresentAudienceApp } from './window/PresentAudienceApp';
import './styles.css';

async function boot() {
  initRemoteSettings();
  await startData();
  // 세션 창과 발표 청중 창은 최소한의 초기화만 한다
  if (!sessionWindowId && !presentWindowId) restoreLastPage();
  // 원격 모드는 이 기기에 데이터가 없으므로 백업도 PC에서만 한다
  if (!remoteMode) void startBackupService();
  // 스킬은 기기별 (원격 모드도 이 기기에 둔다). 데모 모드는 저장하지 않는다
  void loadSkills(isDemo() ? null : db);
  actions().updateSettings({ theme: initialThemePref() });
  // 모바일: 카메라로 PC의 QR을 스캔하면 branch://pair 링크로 앱이 열린다 → 페어링 폼에 채운다
  mobile?.onPairLink((uri) => {
    useUi.setState({ pairLink: uri });
    actions().setOverlay('settings');
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {presentWindowId ? (
        <PresentAudienceApp sessionId={presentWindowId} />
      ) : sessionWindowId ? (
        <SessionWindowApp />
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}

void boot();
