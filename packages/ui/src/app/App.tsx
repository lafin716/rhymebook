import { useEffect } from 'react';
import { SelectionMenu } from '../chat/SelectionMenu';
import { TopBar } from '../components/TopBar';
import { DemoBar } from '../demo/DemoBar';
import { NotesModal } from '../notes/NotesModal';
import { SearchPalette } from '../search/SearchPalette';
import { Sidebar } from '../session/Sidebar';
import { SettingsModal } from '../settings/SettingsModal';
import { MainView } from '../views/MainView';
import { PopupLayer } from '../views/PopupLayer';
import { SheetStack } from '../views/SheetStack';
import { actions } from './store';
import { useBreakpoint } from './useBreakpoint';
import { useThemeSync } from './useTheme';

export function App() {
  useThemeSync();
  const bp = useBreakpoint();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const open = actions().overlay === 'search';
        actions().setOverlay(open ? 'none' : 'search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      {import.meta.env.DEV && <DemoBar />}
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
    </div>
  );
}
