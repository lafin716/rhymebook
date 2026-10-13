import { normalizeSkillName, SKILL_LIMITS, validateSkill, type ID, type Skill, type SkillProblem } from '@branch/core';
import { ArrowLeft, Plus, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { actions, useApp } from '../app/store';
import { useBreakpoint } from '../app/useBreakpoint';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import { useSkills } from './skillsStore';

const PROBLEM_TEXT: Record<SkillProblem, string> = {
  name: '명령 이름은 영문 소문자·숫자·한글·-·_ 로 32자까지 쓸 수 있어요 (공백 없이).',
  'name-taken': '같은 명령 이름의 스킬이 이미 있어요.',
  title: '제목을 입력하세요.',
  prompt: '지시 내용을 입력하세요.',
  'too-long': `제목 ${SKILL_LIMITS.title}자, 설명 ${SKILL_LIMITS.description}자, 지시 ${SKILL_LIMITS.prompt}자까지 쓸 수 있어요.`,
};

interface Draft {
  id?: ID;
  name: string;
  title: string;
  description: string;
  prompt: string;
}

const EMPTY: Draft = { name: '', title: '', description: '', prompt: '' };

const toDraft = (s: Skill): Draft => ({ id: s.id, name: s.name, title: s.title, description: s.description, prompt: s.prompt });

const same = (a: Draft, b: Draft) => a.name === b.name && a.title === b.title && a.description === b.description && a.prompt === b.prompt;

/**
 * 스킬 관리 페이지 (IMP-09, ADR-034). 스킬은 채팅 입력창의 + 메뉴나 `/명령`으로 골라
 * 그 질문에 지시를 더한다. 데스크톱은 목록 + 편집 두 칸, 모바일은 목록 → 편집 전환.
 */
export function SkillsPage() {
  const open = useApp((s) => s.overlay === 'skills');
  if (!open) return null;
  return <SkillsPageBody />;
}

function SkillsPageBody() {
  const skills = useSkills((s) => s.skills);
  const mobile = useBreakpoint() === 'mobile';
  const [selected, setSelected] = useState<ID | 'new' | null>(() => (mobile ? null : (skills[0]?.id ?? 'new')));
  const current = useMemo(() => (selected && selected !== 'new' ? skills.find((s) => s.id === selected) : undefined), [selected, skills]);
  const base = current ? toDraft(current) : EMPTY;
  const [draft, setDraft] = useState<Draft>(base);
  const [problem, setProblem] = useState<SkillProblem | null>(null);
  const dirty = !same(draft, base);

  // 선택이 바뀌면 편집 내용을 그 스킬로
  const baseKey = current ? `${current.id}:${current.updatedAt}` : String(selected);
  useEffect(() => {
    setDraft(current ? toDraft(current) : EMPTY);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  const leave = async (): Promise<boolean> =>
    !dirty || (await confirm({ title: '저장하지 않은 변경이 있어요', message: '변경 내용을 버릴까요?', confirmLabel: '버리기', tone: 'danger' }));

  const close = async () => {
    if (await leave()) actions().setOverlay('none');
  };

  const pick = async (id: ID | 'new' | null) => {
    if (id === selected) return;
    if (await leave()) setSelected(id);
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

  const save = () => {
    const next = { ...draft, name: normalizeSkillName(draft.name) };
    const p = validateSkill({ ...next, id: draft.id ?? '' }, skills);
    setProblem(p);
    if (p) return;
    const saved = useSkills.getState().save({ ...next, ...(current?.builtin ? { builtin: true } : {}) });
    // 모바일은 저장 후 목록으로 돌아간다
    setSelected(mobile ? null : saved.id);
    setDraft(mobile ? EMPTY : toDraft(saved));
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirm({
      title: '스킬을 삭제할까요?',
      message: `“${current.title}” (/${current.name}) 스킬을 삭제해요. 이미 보낸 질문에는 영향이 없어요.`,
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!ok) return;
    useSkills.getState().remove(current.id);
    const rest = useSkills.getState().skills;
    setSelected(mobile ? null : (rest[0]?.id ?? 'new'));
  };

  const showList = !mobile || selected === null;
  const showEditor = !mobile || selected !== null;

  return (
    <div role="dialog" aria-modal="true" aria-label="스킬 관리" className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-4">
        <IconButton label={mobile && selected !== null ? '스킬 목록' : '돌아가기'} onClick={() => (mobile && selected !== null ? void pick(null) : void close())}>
          <ArrowLeft size={19} />
        </IconButton>
        <Sparkles size={17} className="text-accent" />
        <h2 className="flex-1 text-[16px] font-semibold">스킬 관리</h2>
        {showList && (
          <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => void pick('new')}>
            새 스킬
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {showList && (
          <nav aria-label="스킬 목록" className={cn('scroll-thin min-h-0 overflow-y-auto p-2', mobile ? 'flex-1' : 'w-72 shrink-0 border-r border-line bg-surface')}>
            {skills.length === 0 ? (
              <div className="px-3 py-8 text-center text-[13px] text-muted">
                <p>스킬이 없어요.</p>
                <Button size="sm" variant="ghost" className="mt-2" icon={<RotateCcw size={14} />} onClick={() => useSkills.getState().restoreDefaults()}>
                  예시 스킬 다시 넣기
                </Button>
              </div>
            ) : (
              skills.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-skill-row={s.name}
                  onClick={() => void pick(s.id)}
                  className={cn(
                    'mb-0.5 w-full rounded-lg px-3 py-2.5 text-left',
                    selected === s.id ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium text-fg">{s.title}</span>
                    <code className="shrink-0 text-[12px] text-accent">/{s.name}</code>
                  </div>
                  {s.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{s.description}</div>}
                </button>
              ))
            )}
          </nav>
        )}

        {showEditor && (
          <section aria-label="스킬 편집" className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
            <form
              className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5 md:px-6"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="text-[13px] text-muted">
                {current ? (
                  <>
                    채팅 입력창에서 <code className="rounded bg-surface-2 px-1 text-accent">/{current.name}</code>을 입력하거나 <b className="font-medium text-fg-2">+ › 스킬</b>에서 고르면, 그 질문에 아래 지시가 더해져요.
                  </>
                ) : (
                  '새 스킬을 만들어요. 명령 이름으로 채팅에서 바로 부를 수 있어요.'
                )}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-2">명령 이름</span>
                <div className="flex h-10 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
                  <span className="text-accent">/</span>
                  <input
                    value={draft.name}
                    maxLength={SKILL_LIMITS.name + 1}
                    placeholder="curriculum"
                    aria-label="명령 이름"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    onBlur={() => setDraft((d) => ({ ...d, name: normalizeSkillName(d.name) }))}
                    className="min-w-0 flex-1 bg-transparent pl-0.5 text-[14.5px] outline-none"
                  />
                </div>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-2">제목</span>
                <input
                  value={draft.title}
                  maxLength={SKILL_LIMITS.title}
                  placeholder="커리큘럼 생성"
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[14.5px] outline-none focus:border-accent"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-fg-2">설명 <span className="font-normal text-muted">(목록과 메뉴에 보여요)</span></span>
                <input
                  value={draft.description}
                  maxLength={SKILL_LIMITS.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  className="h-10 rounded-xl border border-line bg-surface px-3 text-[14.5px] outline-none focus:border-accent"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="flex items-baseline justify-between text-[13px] font-medium text-fg-2">
                  지시
                  <span className="font-normal text-muted">
                    {draft.prompt.length.toLocaleString()} / {SKILL_LIMITS.prompt.toLocaleString()}
                  </span>
                </span>
                <textarea
                  value={draft.prompt}
                  maxLength={SKILL_LIMITS.prompt}
                  rows={16}
                  placeholder="이 스킬을 고른 질문에 모델이 따를 지시를 적어요."
                  onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
                  className="min-h-48 resize-y rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-[13px] leading-relaxed outline-none focus:border-accent"
                />
              </label>

              {problem && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {PROBLEM_TEXT[problem]}
                </p>
              )}

              <div className="safe-bottom flex items-center gap-2 pb-2">
                {current && (
                  <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Trash2 size={15} />} onClick={() => void remove()}>
                    삭제
                  </Button>
                )}
                <span className="flex-1" />
                {dirty && current && (
                  <Button variant="ghost" onClick={() => setDraft(toDraft(current))}>
                    되돌리기
                  </Button>
                )}
                <Button type="submit" variant="primary" icon={<Save size={15} />} disabled={!dirty}>
                  저장
                </Button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
