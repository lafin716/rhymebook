import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { isDemo, mobile } from './app/runtime';
import { actions, loadPersisted } from './app/store';
import { useUi } from './app/uiState';
import { initialThemePref } from './app/useTheme';
import { startBackupService } from './backup/service';
import './styles.css';

async function boot() {
  if (!isDemo()) await loadPersisted();
  void startBackupService();
  actions().updateSettings({ theme: initialThemePref() });
  // 모바일: 카메라로 PC의 QR을 스캔하면 branch://pair 링크로 앱이 열린다 → 설정 › 원격 Bridge 폼에 채운다
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
