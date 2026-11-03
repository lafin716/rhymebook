import { t } from '../i18n';
import {
  buildPromptAssistRequest,
  collectStream,
  finalizePromptAssist,
  parsePromptAssist,
  PROVIDER_LABELS,
  resolveModelOptions,
  type PromptKey,
  type ProviderError,
} from '@branch/core';
import { Square, Undo2, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pickProvider } from '../app/ai';
import { appStore, caps, registry, useApp } from '../app/store';
import { useSync } from '../app/sync';
import { Button } from '../components/Button';
import { usePcOnline } from '../components/PcStatus';
import { cn } from '../lib/cn';

/** 빠른 요청 (렌더 시점에 번역한다) */
const ideas = () =>
  (['concise', 'plain', 'example', 'format'] as const).map((id) => ({
    id,
    label: t(`prompts.assist.idea.${id}.label`),
    text: t(`prompts.assist.idea.${id}.text`),
  }));

interface Props {
  promptKey: PromptKey;
  draft: string;
  /** AI가 채운 문구 (스트리밍 중에도 여러 번 불린다) */
  onDraft(next: string): void;
  onBusy(busy: boolean): void;
}

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; note: string; before: string } | { kind: 'error'; message: string };

/**
 * 프롬프트 편집 칸 위의 AI 도우미 (ADR-112). 스킬 도우미(ADR-037)와 같은 방식으로,
 * 요청대로 고친 문구를 편집 칸에 바로 채운다. 저장은 사용자가 하고, 그 전까지 되돌릴 수 있다.
 */
export function PromptAssist({ promptKey, draft, onDraft, onBusy }: Props) {
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const providerId = useApp(pickProvider);
  const viaPc = providerId === 'remote-bridge' && !caps.localCli;
  const pcOnline = usePcOnline();
  const hostName = useSync((s) => s.hostName);
  const running = status.kind === 'running';

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async () => {
    if (running) return;
    if (viaPc && !pcOnline) {
      setStatus({ kind: 'error', message: t('prompts.assist.notConnectedPc') });
      return;
    }
    const provider = registry.get(providerId);
    if (!provider) {
      setStatus({ kind: 'error', message: t('prompts.assist.noAi') });
      return;
    }
    const before = draft;
    const c = new AbortController();
    ctrl.current = c;
    setStatus({ kind: 'running' });
    onBusy(true);
    const req = buildPromptAssistRequest({ key: promptKey, current: before, request, prompts: appStore.getState().settings.prompts });
    if (caps.modelChoice) Object.assign(req, resolveModelOptions(providerId, undefined, appStore.getState().connections[providerId]));
    req.signal = c.signal;
    try {
      const raw = await collectStream(provider, req, (text) => {
        if (c.signal.aborted) return;
        const p = parsePromptAssist(text, true);
        if (p.prompt !== undefined) onDraft(p.prompt);
      });
      if (c.signal.aborted) {
        onDraft(before);
        setStatus({ kind: 'idle' });
        return;
      }
      const result = parsePromptAssist(raw);
      const final = finalizePromptAssist(result);
      if (!final) {
        onDraft(before);
        setStatus({ kind: 'error', message: t('prompts.assist.parseFailed') });
        return;
      }
      onDraft(final);
      setRequest('');
      setStatus({ kind: 'done', note: result.note || t('prompts.assist.editedNote'), before });
    } catch (e) {
      onDraft(before);
      const err = e as Partial<ProviderError>;
      setStatus(err?.code === 'aborted' ? { kind: 'idle' } : { kind: 'error', message: err?.message ?? t('prompts.assist.failed') });
    } finally {
      if (ctrl.current === c) ctrl.current = null;
      onBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div data-prompt-assist className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <WandSparkles size={15} className="text-accent" />
        {t('prompts.assist.title')}
        <span
          className="ml-auto truncate text-[11.5px] font-normal text-muted"
          title={viaPc ? t('prompts.assist.viaPcTitle') : t('prompts.assist.defaultTitle')}
        >
          {viaPc ? t('prompts.assist.pcRemote', { host: hostName ?? 'PC' }) : PROVIDER_LABELS[providerId]}
        </span>
      </div>
      <textarea
        ref={input}
        value={request}
        rows={2}
        disabled={running}
        aria-label={t('prompts.assist.requestLabel')}
        placeholder={t('prompts.assist.placeholder')}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-accent disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ideas().map((i) => (
          <button
            key={i.id}
            type="button"
            disabled={running}
            onClick={() => {
              setRequest(i.text);
              input.current?.focus();
            }}
            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-fg-2 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {i.label}
          </button>
        ))}
        <span className="flex-1" />
        {running ? (
          <Button size="sm" icon={<Square size={13} />} onClick={() => ctrl.current?.abort()}>
            {t('prompts.assist.stop')}
          </Button>
        ) : (
          <Button size="sm" variant="soft" icon={<WandSparkles size={14} />} onClick={() => void run()}>
            {t('prompts.assist.title')}
          </Button>
        )}
      </div>
      {(running || status.kind === 'done' || status.kind === 'error') && (
        <div
          role={status.kind === 'error' ? 'alert' : 'status'}
          className={cn('mt-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px]', status.kind === 'error' ? 'bg-danger-soft text-danger' : 'bg-surface text-fg-2')}
        >
          {running && <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />}
          <span className="min-w-0 flex-1">
            {running ? t('prompts.assist.running') : status.kind === 'done' ? status.note : status.kind === 'error' ? status.message : ''}
          </span>
          {status.kind === 'done' && (
            <button
              type="button"
              onClick={() => {
                onDraft(status.before);
                setStatus({ kind: 'idle' });
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-accent hover:bg-accent-soft"
            >
              <Undo2 size={13} />
              {t('prompts.assist.undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
