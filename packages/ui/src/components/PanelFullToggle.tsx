import { t } from '../i18n';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useUi } from '../app/uiState';
import { IconButton } from './Button';

/** 캔버스·페이지 헤더 우측의 전체 화면 버튼 — 상단 바·사이드바를 숨기고 패널만 보인다 */
export function PanelFullToggle() {
  const full = useUi((s) => s.panelFull);
  const label = full ? t('components.panel.exitFull') : t('components.panel.fullScreen');
  return (
    <IconButton label={label} size="sm" active={full} aria-pressed={full} data-panel-full="" onClick={() => useUi.getState().setPanelFull(!full)}>
      {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
    </IconButton>
  );
}
