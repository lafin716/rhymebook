import { t } from '../i18n';
import {
  buildSkillAssistRequest,
  collectStream,
  finalizeSkillAssist,
  mergeSkillFiles,
  parseSkillAssist,
  PROVIDER_LABELS,
  resolveModelOptions,
  type ID,
  type ProviderError,
  type Skill,
  type SkillFields,
} from '@branch/core';
import { Square, Undo2, WandSparkles } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { pickProvider } from '../app/ai';
import { appStore, caps, registry, useApp } from '../app/store';
import { useSync } from '../app/sync';
import { Button } from '../components/Button';
import { usePcOnline } from '../components/PcStatus';
import { cn } from '../lib/cn';

/** 새 스킬 예시 요청 (렌더 시점에 번역한다) */
const newIdeas = () => [
  { id: 'vocab', label: t('skills.assist.idea.vocab.label'), text: t('skills.assist.idea.vocab.text') },
  { id: 'quiz', label: t('skills.assist.idea.quiz.label'), text: t('skills.assist.idea.quiz.text') },
  { id: 'socratic', label: t('skills.assist.idea.socratic.label'), text: t('skills.assist.idea.socratic.text') },
  { id: 'simple', label: t('skills.assist.idea.simple.label'), text: t('skills.assist.idea.simple.text') },
];

/** 고치기 빠른 요청 (렌더 시점에 번역한다) */
const editIdeas = () => [
  { id: 'concise', label: t('skills.assist.idea.concise.label'), text: t('skills.assist.idea.concise.text') },
  { id: 'example', label: t('skills.assist.idea.example.label'), text: t('skills.assist.idea.example.text') },
  { id: 'format', label: t('skills.assist.idea.format.label'), text: t('skills.assist.idea.format.text') },
  { id: 'beginner', label: t('skills.assist.idea.beginner.label'), text: t('skills.assist.idea.beginner.text') },
];

interface Props {
  draft: SkillFields & { id?: ID };
  /** AI가 채운 값 (스트리밍 중에도 여러 번 불린다) */
  onDraft(next: SkillFields): void;
  skills: readonly Skill[];
  onBusy(busy: boolean): void;
  autoFocus?: boolean;
}

type Status = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; note: string; before: SkillFields } | { kind: 'error'; message: string };

/**
 * 스킬 편집 칸 위의 AI 도우미 (IMP-11, ADR-037).
 * 원하는 것을 적으면 AI가 명령 이름·제목·설명·지시를 채우거나(새 스킬) 고친다(편집 중인 스킬).
 * 결과는 편집 칸에 바로 채워지고 저장 전까지는 되돌릴 수 있다.
 */
export function SkillAssist({ draft, onDraft, skills, onBusy, autoFocus }: Props) {
  const [request, setRequest] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const ctrl = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const providerId = useApp(pickProvider);
  const viaPc = providerId === 'remote-bridge' && !caps.localCli;
  const pcOnline = usePcOnline();
  const hostName = useSync((s) => s.hostName);
  const editing = !!(draft.title.trim() || draft.prompt.trim() || draft.files.length);
  const running = status.kind === 'running';

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  const run = async () => {
    if (running) return;
    if (viaPc && !pcOnline) {
      setStatus({ kind: 'error', message: t('skills.assist.notConnectedPc') });
      return;
    }
    const before: SkillFields = { name: draft.name, title: draft.title, description: draft.description, prompt: draft.prompt, files: draft.files };
    const provider = registry.get(providerId);
    if (!provider) {
      setStatus({ kind: 'error', message: t('skills.assist.noAi') });
      return;
    }
    const c = new AbortController();
    ctrl.current = c;
    setStatus({ kind: 'running' });
    onBusy(true);
    const req = buildSkillAssistRequest({ request, current: before, takenNames: skills.filter((s) => s.id !== draft.id).map((s) => s.name), prompts: appStore.getState().settings.prompts });
    if (caps.modelChoice) Object.assign(req, resolveModelOptions(providerId, undefined, appStore.getState().connections[providerId]));
    req.signal = c.signal;
    try {
      const raw = await collectStream(provider, req, (t) => {
        if (c.signal.aborted) return;
        const p = parseSkillAssist(t, true);
        onDraft({
          name: p.name ?? before.name,
          title: p.title ?? before.title,
          description: p.description ?? before.description,
          prompt: p.prompt ?? before.prompt,
          files: p.files || p.deletes ? mergeSkillFiles(before.files, p) : before.files,
        });
      });
      if (c.signal.aborted) {
        onDraft(before);
        setStatus({ kind: 'idle' });
        return;
      }
      const result = parseSkillAssist(raw);
      const final = finalizeSkillAssist(result, before, skills, draft.id);
      if (!final) {
        onDraft(before);
        setStatus({ kind: 'error', message: t('skills.assist.parseFailed') });
        return;
      }
      onDraft(final);
      setRequest('');
      setStatus({ kind: 'done', note: result.note || (editing ? t('skills.assist.editedNote') : t('skills.assist.createdNote')), before });
    } catch (e) {
      onDraft(before);
      const err = e as Partial<ProviderError>;
      setStatus(err?.code === 'aborted' ? { kind: 'idle' } : { kind: 'error', message: err?.message ?? t('skills.assist.failed') });
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

  const ideas = editing ? editIdeas() : newIdeas();

  return (
    <div data-skill-assist className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <WandSparkles size={15} className="text-accent" />
        {editing ? t('skills.assist.editWithAi') : t('skills.assist.createWithAi')}
        <span
          className="ml-auto truncate text-[11.5px] font-normal text-muted"
          title={viaPc ? t('skills.assist.viaPcTitle') : t('skills.assist.defaultTitle')}
        >
          {viaPc ? t('skills.assist.pcRemote', { host: hostName ?? 'PC' }) : PROVIDER_LABELS[providerId]}
        </span>
      </div>
      <textarea
        ref={input}
        value={request}
        rows={2}
        disabled={running}
        aria-label={t('skills.assist.requestLabel')}
        placeholder={editing ? t('skills.assist.placeholderEdit') : t('skills.assist.placeholderNew')}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-accent disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ideas.map((i) => (
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
            {t('skills.assist.stop')}
          </Button>
        ) : (
          <Button size="sm" variant="soft" icon={<WandSparkles size={14} />} onClick={() => void run()} disabled={!editing && !request.trim()}>
            {editing ? t('skills.assist.editWithAi') : t('skills.assist.createWithAi')}
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
            {running ? t('skills.assist.running') : status.kind === 'done' ? status.note : status.kind === 'error' ? status.message : ''}
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
              {t('skills.assist.undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
