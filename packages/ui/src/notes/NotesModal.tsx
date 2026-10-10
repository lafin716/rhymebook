import { buildAnkiDeck, buildStudyNotes, collectStudyCards, studyNotesFileName, type ID } from '@branch/core';
import { Copy, Download, GitBranch, Layers, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { actions, useApp } from '../app/store';
import { Button, IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { saveTextFile } from '../lib/download';

/** 이해 노트: 현재 세션 트리의 앵커·요약을 모아 보고 Markdown/Anki로 내보낸다 (ADR-022) */
export function NotesModal() {
  const open = useApp((s) => s.overlay === 'notes');
  const rootId = useApp((s) => {
    const a = s.view.activeSessionId;
    return a ? s.sessions[a]?.rootId : undefined;
  });
  const close = () => actions().setOverlay('none');
  return (
    <Modal open={open} onClose={close} label="이해 노트" className="md:max-w-2xl">
      {open && rootId && <NotesBody rootId={rootId} onClose={close} />}
    </Modal>
  );
}

function NotesBody({ rootId, onClose }: { rootId: ID; onClose(): void }) {
  const sessions = useApp((s) => s.sessions);
  const messages = useApp((s) => s.messages);
  const root = sessions[rootId];
  const cards = useMemo(() => collectStudyCards(sessions, messages, rootId), [sessions, messages, rootId]);
  const summarized = cards.filter((c) => c.summary).length;
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const run = async (fn: () => Promise<string>) => {
    try {
      setNotice({ tone: 'ok', text: await fn() });
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };
  const markdown = () => buildStudyNotes(sessions, messages, rootId);
  const title = root?.title ?? '이해 노트';

  return (
    <>
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">이해 노트 · {title}</h2>
        <IconButton label="이해 노트 닫기" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        <p className="mb-3 text-[13px] text-muted">
          가지 {cards.length}개 · 요약 {summarized}개. 가지에서 이해한 내용을 모아 복습하거나 파일로 내보냅니다.
        </p>
        {cards.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[14px] text-muted">
            아직 가지가 없어요. 답변에서 모르는 부분을 선택해 가지를 만들어 보세요.
          </div>
        ) : (
          <ol className="space-y-2">
            {cards.map((c) => (
              <li key={c.sessionId} style={{ marginLeft: `${Math.min(c.depth - 1, 4) * 12}px` }}>
                <button
                  type="button"
                  onClick={() => {
                    actions().openSession(c.sessionId, 'main');
                    onClose();
                  }}
                  className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-left hover:bg-surface-2/70"
                >
                  <div className="flex items-center gap-1.5 text-[14px] font-medium text-fg">
                    <GitBranch size={13} className="shrink-0 text-muted" />
                    <span className="shrink-0 text-muted">{c.number}</span>
                    <span className="truncate">{c.title}</span>
                  </div>
                  {c.context && (
                    <div className="mt-1 line-clamp-2 text-[12.5px] text-fg-2">
                      {c.context.before}
                      <mark className="anchor">{c.context.text}</mark>
                      {c.context.after}
                    </div>
                  )}
                  <div className={c.summary ? 'mt-1.5 text-[13px] text-fg' : 'mt-1.5 text-[12.5px] text-muted italic'}>
                    {c.summary ?? '요약 없음 — 가지에서 [부모에 요약 붙이기]를 하면 채워집니다.'}
                  </div>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {notice && (
          <p role="status" className={`w-full text-[12.5px] ${notice.tone === 'error' ? 'text-danger' : 'text-muted'}`}>
            {notice.text}
          </p>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={<Download size={14} />}
          disabled={!cards.length}
          onClick={() =>
            void run(async () => {
              await saveTextFile(studyNotesFileName(title, 'md'), markdown(), 'text/markdown');
              return 'Markdown 노트를 저장했어요.';
            })
          }
        >
          Markdown 저장
        </Button>
        <Button
          size="sm"
          icon={<Layers size={14} />}
          disabled={!summarized}
          title={summarized ? undefined : '요약이 있는 가지만 카드가 됩니다'}
          onClick={() =>
            void run(async () => {
              const deck = buildAnkiDeck(sessions, messages, rootId);
              await saveTextFile(studyNotesFileName(title, 'txt'), deck.text, 'text/tab-separated-values');
              return `Anki 카드 ${deck.count}장을 저장했어요. Anki › 파일 › 가져오기로 불러오세요.`;
            })
          }
        >
          Anki 카드
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={<Copy size={14} />}
          disabled={!cards.length}
          onClick={() =>
            void run(async () => {
              await navigator.clipboard.writeText(markdown());
              return 'Markdown을 클립보드에 복사했어요.';
            })
          }
        >
          복사
        </Button>
      </div>
    </>
  );
}
