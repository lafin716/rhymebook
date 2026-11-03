import { t } from '../i18n';
import { remoteMode } from '../app/capabilities';
import { useApp } from '../app/store';
import { cn } from '../lib/cn';
import { Library } from 'lucide-react';
import { useState } from 'react';
import type { ID } from '@branch/core';
import { knowledgeApi } from './api';
import { KnowledgeDialog } from './KnowledgeDialog';

/**
 * 세션 상단의 지식베이스 버튼 (ADR-107). 지식베이스는 학습(루트 세션)에 붙고 가지도 같이 쓴다.
 * 원격 모드(웹·모바일이 PC 미러)는 버튼만 보이고 대화상자가 "PC 앱에서 관리"를 안내한다.
 */
export function KnowledgeButton({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const linked = useApp((s) => {
    const rootId = s.sessions[sessionId]?.rootId;
    return rootId ? !!s.sessions[rootId]?.knowledgeId : false;
  });
  if (!remoteMode && !knowledgeApi()) return null;
  const label = remoteMode ? t('knowledge.button.remoteTitle') : t('knowledge.button.title');
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        data-knowledge-button=""
        data-linked={linked ? '' : undefined}
        onClick={() => setOpen(true)}
        className={cn(
          'relative inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 text-[12px] text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg',
          compact ? 'h-7' : 'h-8',
        )}
      >
        <Library size={14} />
        <span className={cn(compact ? 'hidden' : 'hidden sm:inline')}>{t('knowledge.button.label')}</span>
        {linked && <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent ring-2 ring-surface" />}
      </button>
      <KnowledgeDialog open={open} onClose={() => setOpen(false)} sessionId={sessionId} />
    </>
  );
}
