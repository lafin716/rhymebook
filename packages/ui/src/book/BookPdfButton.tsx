import { isBookSession, type ID } from '@branch/core';
import { BookDown, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { cn } from '../lib/cn';
import { exportBookPdf } from './exportBook';
import { t } from '../i18n';

/** /book 세션 헤더의 [책 PDF로 저장] (ADR-044) */
export function BookPdfButton({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const isBook = useApp((s) => isBookSession(s.messages[sessionId]));
  const streaming = useApp((s) => !!s.streaming[sessionId]);
  const [busy, setBusy] = useState(false);
  if (!isBook) return null;

  const run = async () => {
    setBusy(true);
    try {
      pushNotice(await exportBookPdf(sessionId));
    } catch (e) {
      pushNotice(e instanceof Error && e.message && e.message !== 'timeout' ? e.message : t('book.pdf.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy || streaming}
      aria-label={t('book.pdf.save')}
      title={streaming ? t('book.pdf.waitTitle') : t('book.pdf.saveTitle')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2 text-[12.5px] font-medium text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40',
        compact ? 'h-7' : 'h-8',
      )}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : <BookDown size={14} />}
      <span className="hidden sm:inline">{t('book.pdf.label')}</span>
    </button>
  );
}
