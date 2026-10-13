import { BookOpenCheck, Menu, Monitor, Moon, Network, PanelLeftClose, PanelLeftOpen, Search, Settings2, Sun } from 'lucide-react';
import { actions, useApp } from '../app/store';
import { useUi } from '../app/uiState';
import { useBreakpoint } from '../app/useBreakpoint';
import { cn } from '../lib/cn';
import { modKeyLabel } from '../lib/platform';
import { IconButton } from './Button';
import { Kbd } from './Kbd';
import { PcStatusChip } from './PcStatus';


const THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' } as const;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: '시스템', light: '라이트', dark: '다크' };

/** 상단 바: 목록(모바일/태블릿 드로어, 데스크톱 접기), 루트 제목, 마인드맵 토글, 검색, 설정, 테마 */
export function TopBar() {
  const bp = useBreakpoint();
  const mode = useApp((s) => s.view.mode);
  const theme = useApp((s) => s.settings.theme);
  const rootTitle = useApp((s) => {
    const a = s.view.activeSessionId;
    const root = a ? s.sessions[s.sessions[a]?.rootId ?? ''] : undefined;
    return root?.title ?? 'rhymebook';
  });
  const hasRoot = useApp((s) => !!(s.view.activeSessionId && s.sessions[s.view.activeSessionId]));
  const ThemeIcon = THEME_ICON[theme];
  const mobile = bp === 'mobile';
  const collapsed = useUi((s) => s.sidebarCollapsed);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-2 md:h-13 md:px-3">
      {bp === 'desktop' ? (
        <IconButton
          label={collapsed ? '세션 목록 펼치기' : '세션 목록 접기'}
          title={`${collapsed ? '세션 목록 펼치기' : '세션 목록 접기'} (${modKeyLabel}B)`}
          aria-expanded={!collapsed}
          onClick={() => useUi.getState().toggleSidebar()}
        >
          {collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}
        </IconButton>
      ) : (
        <IconButton label="세션 목록" onClick={() => useUi.getState().setDrawer(true)}>
          <Menu size={19} />
        </IconButton>
      )}
      <div className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{rootTitle}</div>

      <PcStatusChip compact={mobile} />

      {hasRoot && (
        <button
          type="button"
          aria-pressed={mode === 'mindmap'}
          title={mode === 'mindmap' ? '마인드맵 닫기' : '마인드맵'}
          aria-label="마인드맵"
          onClick={() => (mode === 'mindmap' ? actions().closeMindmap() : actions().setMode('mindmap'))}
          className={cn(
            'flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] transition-colors',
            mode === 'mindmap' ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
          )}
        >
          <Network size={15} />
          {!mobile && <span>마인드맵</span>}
        </button>
      )}
      {mobile ? (
        <IconButton label="세션 검색" onClick={() => actions().setOverlay('search')}>
          <Search size={18} />
        </IconButton>
      ) : (
        <button
          type="button"
          onClick={() => actions().setOverlay('search')}
          className="ml-1 flex h-8 items-center gap-2 rounded-lg border border-line px-2.5 text-[13px] text-muted hover:bg-surface-2"
        >
          <Search size={15} />
          {bp === 'desktop' && <span>검색</span>}
          <Kbd>{modKeyLabel}K</Kbd>
        </button>
      )}
      {hasRoot && (
        <IconButton label="이해 노트" title="이해 노트" onClick={() => actions().setOverlay('notes')}>
          <BookOpenCheck size={18} />
        </IconButton>
      )}
      <IconButton label={`테마: ${THEME_LABEL[theme]}`} title={`테마: ${THEME_LABEL[theme]}`} onClick={() => actions().setTheme(THEME_NEXT[theme])}>
        <ThemeIcon size={18} />
      </IconButton>
      <IconButton label="설정" onClick={() => actions().setOverlay('settings')}>
        <Settings2 size={18} />
      </IconButton>
    </header>
  );
}
