import { buildAnkiDeck, buildStudyNotes, collectStudyCards, studyNotesFileName, type ID } from '@branch/core';
import { BookText, Copy, Download, FileDown, FileUp, GitBranch, Layers, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { Button, IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { saveTextFile } from '../lib/download';
import { exportStudy, importStudyFile, makeBook } from './study';

/**
 * 이해 노트: 현재 세션 트리의 앵커·요약을 모아 보고 Markdown/Anki로 내보낸다 (ADR-022).
 * 학습 꾸러미 내보내기·가져오기와 책으로 만들기 (ADR-043). 열린 학습이 없으면 가져오기만
 */
export function NotesModal() {
  const open = useApp((s) => s.overlay === 'notes');
  const rootId = useApp((s) => {
    const a = s.view.activeSessionId;
    return a ? s.sessions[a]?.rootId : undefined;
  });
  const close = () => actions().setOverlay('none');
  return (
    <Modal open={open} onClose={close} label="이해 노트" className="md:max-w-2xl">
      {open && (rootId ? <NotesBody rootId={rootId} onClose={close} /> : <ImportOnly onClose={close} />)}
    </Modal>
  );
}

type Notice = { tone: 'ok' | 'error'; text: string } | null;

function useNotice() {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    try {
      const text = await fn();
      setNotice(text ? { tone: 'ok', text } : null);
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return { notice, busy, run };
}

/** [학습 가져오기] 버튼 + 숨은 파일 입력 */
function ImportButton({ run, busy, onDone, variant = 'secondary' }: { run: ReturnType<typeof useNotice>['run']; busy: boolean; onDone?(rootId: ID): void; variant?: 'primary' | 'secondary' }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" variant={variant} icon={<FileUp size={14} />} disabled={busy} onClick={() => input.current?.click()}>
        학습 가져오기
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        aria-label="학습 꾸러미 파일 선택"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          void run(async () => {
            const r = await importStudyFile(file);
            onDone?.(r.rootId);
            return r.text;
          });
        }}
      />
    </>
  );
}

function Header({ title, onClose }: { title: string; onClose(): void }) {
  return (
    <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
      <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{title}</h2>
      <IconButton label="이해 노트 닫기" onClick={onClose}>
        <X size={18} />
      </IconButton>
    </div>
  );
}

function Footer({ notice, children }: { notice: Notice; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {notice && (
        <p role="status" className={`w-full text-[12.5px] ${notice.tone === 'error' ? 'text-danger' : 'text-muted'}`}>
          {notice.text}
        </p>
      )}
      {children}
    </div>
  );
}

/** 열린 학습이 없을 때: 다른 기기에서 내보낸 학습만 가져온다 */
function ImportOnly({ onClose }: { onClose(): void }) {
  const { notice, busy, run } = useNotice();
  const [imported, setImported] = useState<ID | null>(null);
  return (
    <>
      <Header title="이해 노트" onClose={onClose} />
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
        <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-[14px] text-muted">
          열린 학습이 없어요. 다른 기기에서 [학습 내보내기]로 저장한 zip을 가져와 이어서 학습할 수 있어요.
        </div>
      </div>
      <Footer notice={notice}>
        <ImportButton run={run} busy={busy} variant="primary" onDone={setImported} />
        {imported && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              actions().openSession(imported, 'main');
              onClose();
            }}
          >
            열기
          </Button>
        )}
      </Footer>
    </>
  );
}

function NotesBody({ rootId, onClose }: { rootId: ID; onClose(): void }) {
  const sessions = useApp((s) => s.sessions);
  const messages = useApp((s) => s.messages);
  const root = sessions[rootId];
  const cards = useMemo(() => collectStudyCards(sessions, messages, rootId), [sessions, messages, rootId]);
  const summarized = cards.filter((c) => c.summary).length;
  const { notice, busy, run } = useNotice();
  const hasTalk = cards.length > 0 || (messages[rootId]?.length ?? 0) > 0;
  const markdown = () => buildStudyNotes(sessions, messages, rootId);
  const title = root?.title ?? '이해 노트';

  return (
    <>
      <Header title={`이해 노트 · ${title}`} onClose={onClose} />
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
      <Footer notice={notice}>
        <div className="flex w-full flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            icon={<BookText size={14} />}
            disabled={busy || !hasTalk}
            title="학습 전체를 목차부터 구조적으로 정리해 책으로 엮어요 (/book 스킬)"
            onClick={() =>
              void run(async () => {
                const id = await makeBook(rootId);
                actions().openSession(id, 'main');
                onClose();
                return null;
              })
            }
          >
            책으로 만들기
          </Button>
          <Button size="sm" icon={<FileDown size={14} />} disabled={busy || !hasTalk} title="다른 기기에서 이어서 학습할 수 있게 대화 전체를 zip으로 저장해요" onClick={() => void run(() => exportStudy(rootId))}>
            학습 내보내기
          </Button>
          <ImportButton run={run} busy={busy} />
        </div>
        <Button
          variant="ghost"
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
      </Footer>
    </>
  );
}
