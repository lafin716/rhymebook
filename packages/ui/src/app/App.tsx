import { useEffect } from 'react';
import { SelectionMenu } from '../chat/SelectionMenu';
import { MoveTurnHost } from '../chat/turnActions';
import { ConfirmHost } from '../components/ConfirmDialog';
import { Toasts } from '../components/Toasts';
import { TopBar } from '../components/TopBar';
import { NotesModal } from '../notes/NotesModal';
import { VaultOverlay } from '../vault/VaultOverlay';
import { Onboarding } from '../onboarding/Onboarding';
import { SearchPalette } from '../search/SearchPalette';
import { Sidebar } from '../session/Sidebar';
import { useHostPolicySync } from '../settings/HostCard';
import { SettingsModal } from '../settings/SettingsModal';
import { SkillsPage } from '../skills/SkillsPage';
import { MainView } from '../views/MainView';
import { PopupLayer } from '../views/PopupLayer';
import { SheetStack } from '../views/SheetStack';
import { useScenarioHash } from './scenarios';
import { actions } from './store';
import { useUi } from './uiState';
import { useBreakpoint } from './useBreakpoint';
import { useThemeSync } from './useTheme';

export function App() {
  useThemeSync();
  useHostPolicySync();
  useScenarioHash();
  const bp = useBreakpoint();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const open = actions().overlay === 'search';
        actions().setOverlay(open ? 'none' : 'search');
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b' && window.innerWidth >= 1024) {
        e.preventDefault();
        useUi.getState().toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="relative min-h-0 flex-1">
            <MainView />
          </main>
        </div>
      </div>
      {bp === 'mobile' ? <SheetStack /> : <PopupLayer />}
      <SelectionMenu />
      <SearchPalette />
      <SettingsModal />
      <NotesModal />
      <VaultOverlay />
      <SkillsPage />
      <ConfirmHost />
      <MoveTurnHost />
      <Toasts />
      <Onboarding />
    </div>
  );
}
