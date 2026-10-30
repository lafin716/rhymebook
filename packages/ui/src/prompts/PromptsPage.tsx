import { DEFAULT_PROMPTS, PROMPT_INFO, PROMPT_MAX_CHARS, promptText, sanitizePromptOverrides, type PromptKey } from '@branch/core';
import { ArrowLeft, MessageSquareText, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { remoteMode } from '../app/capabilities';
import { actions, appStore, useApp } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { Badge } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';

const GROUPS = [...new Set(PROMPT_INFO.map((p) => p.group))];

/**
 * 프롬프트 관리 페이지 (ADR-098). 앱이 모델에 보내는 시스템 프롬프트(기본 튜터 지시, 가지·요약·제목·페이지 AI·스킬 도우미)를
 * 사용자가 고친다. 고친 문구는 설정(Settings.prompts)에 저장되고, 비우거나 기본값으로 되돌리면 기본 문구를 쓴다.
 * 원격(웹·모바일)에서는 대화가 PC에서 돌아 PC 설정을 따르므로 보기만 한다.
 */
export function PromptsPage() {
  const open = useApp((s) => s.overlay === 'prompts');
  if (!open) return null;
  return <PromptsPageBody />;
}

function PromptsPageBody() {
  const overrides = useApp((s) => s.settings.prompts);
  const mobile = useBreakpoint() === 'mobile';
  const [selected, setSelected] = useState<PromptKey | null>(mobile ? null : 'base');
  const saved = selected ? promptText(selected, overrides) : '';
  const [draft, setDraft] = useState(saved);
  const dirty = draft !== saved;
  const info = PROMPT_INFO.find((p) => p.key === selected);
  const readOnly = remoteMode;

  // 다른 프롬프트를 고르면 그 저장본으로
  useEffect(() => {
    setDraft(selected ? promptText(selected, appStore.getState().settings.prompts) : '');
  }, [selected]);

  const leave = async (): Promise<boolean> =>
    !dirty || (await confirm({ title: '저장하지 않은 변경이 있어요', message: '변경 내용을 버릴까요?', confirmLabel: '버리기', tone: 'danger' }));

  const close = async () => {
    if (await leave()) actions().setOverlay('none');
  };

  const pick = async (key: PromptKey | null) => {
    if (key === selected) return;
    if (await leave()) setSelected(key);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="alertdialog"]')) return;
      e.preventDefault();
      void close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const write = (key: PromptKey, text: string) => {
    const cur = appStore.getState().settings.prompts ?? {};
    actions().updateSettings({ prompts: sanitizePromptOverrides({ ...cur, [key]: text }) });
  };

  const save = () => {
    if (!selected || readOnly || !dirty) return;
    // 비워 두면 기본 문구로 돌아간다
    const text = draft.trim() ? draft : DEFAULT_PROMPTS[selected];
    write(selected, text);
    setDraft(text);
    if (mobile) setSelected(null);
  };

  const reset = async () => {
    if (!selected || readOnly) return;
    const ok = await confirm({
      title: '기본값으로 되돌릴까요?',
      message: `“${info?.label}”을 앱 기본 문구로 되돌려요. 고친 내용은 지워져요.`,
      confirmLabel: '되돌리기',
      tone: 'danger',
    });
    if (!ok) return;
    write(selected, DEFAULT_PROMPTS[selected]);
    setDraft(DEFAULT_PROMPTS[selected]);
  };

  const custom = (key: PromptKey) => !!sanitizePromptOverrides(overrides)[key];
  const showList = !mobile || selected === null;
  const showEditor = !mobile || selected !== null;

  return (
    <div role="dialog" aria-modal="true" aria-label="프롬프트 관리" className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-4">
        <IconButton label={mobile && selected !== null ? '프롬프트 목록' : '돌아가기'} onClick={() => (mobile && selected !== null ? void pick(null) : void close())}>
          <ArrowLeft size={19} />
        </IconButton>
        <MessageSquareText size={17} className="text-accent" />
        <h2 className="flex-1 text-[16px] font-semibold">프롬프트 관리</h2>
      </header>

      {readOnly && (
        <p role="note" className="shrink-0 border-b border-line bg-warn-soft px-4 py-2 text-[13px] text-warn">
          대화는 PC에서 실행돼 PC 앱의 프롬프트를 따라요. 프롬프트는 PC 앱에서 바꿀 수 있어요.
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {showList && (
          <nav aria-label="프롬프트 목록" className={cn('scroll-thin min-h-0 overflow-y-auto p-2', mobile ? 'flex-1' : 'w-72 shrink-0 border-r border-line bg-surface')}>
            {GROUPS.map((group) => (
              <div key={group} className="mb-2">
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted">{group}</div>
                {PROMPT_INFO.filter((p) => p.group === group).map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    data-prompt-row={p.key}
                    onClick={() => void pick(p.key)}
                    className={cn('mb-0.5 w-full rounded-lg px-3 py-2.5 text-left', selected === p.key ? 'bg-accent-soft' : 'hover:bg-surface-2')}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-fg">{p.label}</span>
                      {custom(p.key) && (
                        <Badge tone="accent" className="ml-auto shrink-0">
                          수정됨
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{p.description}</div>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        )}

        {showEditor && selected && info && (
          <section aria-label="프롬프트 편집" className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
            <form
              className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5 md:px-6"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-fg">{info.label}</h3>
                  {custom(selected) ? <Badge tone="accent">수정됨</Badge> : <Badge tone="neutral">기본값</Badge>}
                </div>
                <p className="mt-1 text-[13px] text-muted">{info.description}</p>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between text-[13px] font-medium text-fg-2">
                  시스템 프롬프트
                  <span className="font-normal text-muted">
                    {draft.length.toLocaleString()} / {PROMPT_MAX_CHARS.toLocaleString()}
                  </span>
                </span>
                <textarea
                  value={draft}
                  maxLength={PROMPT_MAX_CHARS}
                  rows={18}
                  readOnly={readOnly}
                  aria-label={`${info.label} 프롬프트`}
                  placeholder="비워 두고 저장하면 기본 문구를 써요."
                  onChange={(e) => setDraft(e.target.value)}
                  className="min-h-56 resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-accent read-only:opacity-70"
                />
              </label>
              <p className="-mt-2 text-[12px] text-muted">바꾼 프롬프트는 다음에 보내는 질문부터 적용돼요. 이미 받은 답변은 그대로예요.</p>

              {!readOnly && (
                <div className="safe-bottom flex items-center gap-2 pb-2">
                  <Button variant="ghost" icon={<RotateCcw size={15} />} disabled={!custom(selected) && draft === DEFAULT_PROMPTS[selected]} onClick={() => void reset()}>
                    기본값으로 되돌리기
                  </Button>
                  <span className="flex-1" />
                  {dirty && (
                    <Button variant="ghost" onClick={() => setDraft(saved)}>
                      취소
                    </Button>
                  )}
                  <Button type="submit" variant="primary" icon={<Save size={15} />} disabled={!dirty}>
                    저장
                  </Button>
                </div>
              )}
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
