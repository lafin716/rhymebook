import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { remoteMode } from './app/capabilities';
import { mobile } from './app/runtime';
import { actions } from './app/store';
import { initRemoteSettings, startData } from './app/sync';
import { useUi } from './app/uiState';
import { initialThemePref } from './app/useTheme';
import { startBackupService } from './backup/service';
import './styles.css';

async function boot() {
  initRemoteSettings();
  await startData();
  // 원격 모드는 이 기기에 데이터가 없으므로 백업도 PC에서만 한다
  if (!remoteMode) void startBackupService();
  actions().updateSettings({ theme: initialThemePref() });
  // 모바일: 카메라로 PC의 QR을 스캔하면 branch://pair 링크로 앱이 열린다 → 페어링 폼에 채운다
  mobile?.onPairLink((uri) => {
    useUi.setState({ pairLink: uri });
    actions().setOverlay('settings');
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
