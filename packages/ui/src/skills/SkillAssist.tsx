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

/** 새 스킬 예시 요청 */
const NEW_IDEAS = [
  { label: '단어 암기', text: '영어 단어를 주면 뜻·예문·어원·헷갈리는 단어와 함께 외우게 도와주는 스킬' },
  { label: '개념 퀴즈', text: '주제를 주면 핵심 개념 5개로 퀴즈를 내고, 답을 접어 두어 스스로 확인하게 하는 스킬' },
  { label: '소크라테스 문답', text: '바로 답하지 않고 질문을 던져 학습자가 스스로 답에 이르게 이끄는 스킬' },
  { label: '쉽게 풀어 주기', text: '어려운 개념을 중학생도 알 수 있게 비유와 그림 같은 예로 풀어 주는 스킬' },
];

/** 고치기 빠른 요청 */
const EDIT_IDEAS = [
  { label: '더 간결하게', text: '지시를 더 짧고 간결하게 다듬어 줘. 핵심 규칙은 유지해.' },
  { label: '예시 더하기', text: '모델이 따라 할 수 있게 출력 예시를 하나 더해 줘.' },
  { label: '출력 형식 분명히', text: '출력 형식(제목·목록·표·분량)을 더 분명하게 정해 줘.' },
  { label: '초보자 눈높이', text: '처음 배우는 사람 눈높이에 맞게 설명 수준을 낮추도록 고쳐 줘.' },
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
      setStatus({ kind: 'error', message: 'PC와 연결되어 있지 않아요. 먼저 PC에 연결하세요.' });
      return;
    }
    const before: SkillFields = { name: draft.name, title: draft.title, description: draft.description, prompt: draft.prompt, files: draft.files };
    const provider = registry.get(providerId);
    if (!provider) {
      setStatus({ kind: 'error', message: '쓸 수 있는 AI 연결이 없어요. 설정에서 연결을 확인하세요.' });
      return;
    }
    const c = new AbortController();
    ctrl.current = c;
    setStatus({ kind: 'running' });
    onBusy(true);
    const req = buildSkillAssistRequest({ request, current: before, takenNames: skills.filter((s) => s.id !== draft.id).map((s) => s.name) });
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
        setStatus({ kind: 'error', message: 'AI 응답에서 스킬을 읽지 못했어요. 요청을 조금 바꿔 다시 해 보세요.' });
        return;
      }
      onDraft(final);
      setRequest('');
      setStatus({ kind: 'done', note: result.note || (editing ? '요청대로 고쳤어요.' : '새 스킬을 채웠어요.'), before });
    } catch (e) {
      onDraft(before);
      const err = e as Partial<ProviderError>;
      setStatus(err?.code === 'aborted' ? { kind: 'idle' } : { kind: 'error', message: err?.message ?? 'AI 작성에 실패했어요.' });
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

  const ideas = editing ? EDIT_IDEAS : NEW_IDEAS;

  return (
    <div data-skill-assist className="rounded-xl border border-accent/30 bg-accent-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-fg-2">
        <WandSparkles size={15} className="text-accent" />
        {editing ? 'AI로 고치기' : 'AI로 만들기'}
        <span
          className="ml-auto truncate text-[11.5px] font-normal text-muted"
          title={viaPc ? 'PC의 원격 설정(에이전트·모델·노력치)으로 작성해요' : '설정의 기본 연결을 써요'}
        >
          {viaPc ? `${hostName ?? 'PC'} · 원격 설정` : PROVIDER_LABELS[providerId]}
        </span>
      </div>
      <textarea
        ref={input}
        value={request}
        rows={2}
        disabled={running}
        aria-label="AI에게 요청"
        placeholder={editing ? '어떻게 고칠지 적어 주세요. 예: 점검 질문을 3개로 늘리고 표로 정리해 줘' : '어떤 스킬이 필요한지 적어 주세요. 예: 코드를 주면 한 줄씩 풀어 설명하는 스킬'}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-accent disabled:opacity-60"
      />
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {ideas.map((i) => (
          <button
            key={i.label}
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
            중지
          </Button>
        ) : (
          <Button size="sm" variant="soft" icon={<WandSparkles size={14} />} onClick={() => void run()} disabled={!editing && !request.trim()}>
            {editing ? 'AI로 고치기' : 'AI로 만들기'}
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
            {running ? 'AI가 작성하고 있어요… 아래 칸에 바로 채워져요.' : status.kind === 'done' ? status.note : status.kind === 'error' ? status.message : ''}
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
              AI 변경 취소
            </button>
          )}
        </div>
      )}
    </div>
  );
}
