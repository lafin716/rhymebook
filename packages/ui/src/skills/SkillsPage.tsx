import {
  makeSkillOptions,
  normalizeSkillName,
  SKILL_FILE_LIMITS,
  SKILL_LIMITS,
  validateSkill,
  validateSkillFiles,
  type ID,
  type Skill,
  type SkillFile,
  type SkillFilesProblem,
  type SkillProblem,
} from '@branch/core';
import { ArrowLeft, FolderOpen, Plus, RefreshCw, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sessionWindowId } from '../app/runtime';
import { actions, useApp } from '../app/store';
import { pushNotice, syncClient, useSync } from '../app/sync';
import { useBreakpoint } from '../app/useBreakpoint';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import { SkillAssist } from './SkillAssist';
import { SkillFilesField, SkillOptionsField, type OptionsDraft } from './SkillExtras';
import { openSkillFolder, pullSkillsFromPc, skillFoldersAvailable, skillFoldersRoot, syncSkillFolders, useSkills } from './skillsStore';

/** 웹·모바일: PC 스킬 동기화 버튼 (세션 창은 PC와 같은 스킬 DB를 쓰므로 필요 없다) */
const pcSkillSync = !!syncClient && !sessionWindowId;

const PROBLEM_TEXT: Record<SkillProblem, string> = {
  name: '명령 이름은 영문 소문자·숫자·한글·-·_ 로 32자까지 쓸 수 있어요 (공백 없이).',
  'name-taken': '같은 명령 이름의 스킬이 이미 있어요.',
  title: '제목을 입력하세요.',
  prompt: '지시 내용을 입력하세요.',
  'too-long': `제목 ${SKILL_LIMITS.title}자, 설명 ${SKILL_LIMITS.description}자, 지시 ${SKILL_LIMITS.prompt}자까지 쓸 수 있어요.`,
};

const FILES_TEXT: Record<SkillFilesProblem, string> = {
  path: '파일 경로는 영문·숫자·한글·._- 로 된 상대 경로만 쓸 수 있어요 (예: references/guide.md, SKILL.md 제외).',
  duplicate: '같은 경로의 파일이 두 개 있어요.',
  count: `파일은 ${SKILL_FILE_LIMITS.count}개까지 둘 수 있어요.`,
  size: `파일 하나는 ${SKILL_FILE_LIMITS.file.toLocaleString()}자, 전체는 ${SKILL_FILE_LIMITS.total.toLocaleString()}자까지예요.`,
};

interface Draft extends OptionsDraft {
  id?: ID;
  name: string;
  title: string;
  description: string;
  prompt: string;
  files: SkillFile[];
}

const EMPTY: Draft = { name: '', title: '', description: '', prompt: '', files: [], providerId: '', model: '', effort: '' };

const toDraft = (s: Skill): Draft => ({
  id: s.id,
  name: s.name,
  title: s.title,
  description: s.description,
  prompt: s.prompt,
  files: s.files ?? [],
  providerId: s.options?.providerId ?? '',
  model: s.options?.model ?? '',
  effort: s.options?.effort ?? '',
});

const sameFiles = (a: SkillFile[], b: SkillFile[]) => a.length === b.length && a.every((f, i) => f.path === b[i]!.path && f.content === b[i]!.content);

const same = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.title === b.title &&
  a.description === b.description &&
  a.prompt === b.prompt &&
  sameFiles(a.files, b.files) &&
  a.providerId === b.providerId &&
  a.model === b.model &&
  a.effort === b.effort;

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
  // + 메뉴의 'AI로 스킬 만들기'로 열면 새 스킬(AI 칸에 바로 입력)부터
  const [selected, setSelected] = useState<ID | 'new' | null>(() =>
    useSkills.getState().takeAiIntent() ? 'new' : mobile ? null : (skills[0]?.id ?? 'new'),
  );
  const [aiBusy, setAiBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const syncStatus = useSync((s) => s.status);
  const current = useMemo(() => (selected && selected !== 'new' ? skills.find((s) => s.id === selected) : undefined), [selected, skills]);
  const base = current ? toDraft(current) : EMPTY;
  const [draft, setDraft] = useState<Draft>(base);
  const [problem, setProblem] = useState<SkillProblem | SkillFilesProblem | null>(null);
  const dirty = !same(draft, base);

  // 선택이 바뀌면 편집 내용을 그 스킬로. 같은 스킬이 폴더에서 바뀌었으면 고치던 내용이 없을 때만 따라간다
  const baseKey = current ? `${current.id}:${current.updatedAt}` : String(selected);
  const shown = useRef<{ key: string; id: ID | 'new' | null; draft: Draft }>({ key: baseKey, id: selected, draft });
  /** 편집을 시작한 시점의 저장본: 폴더에서 바뀌었는지, 사용자가 어떤 파일을 뺐는지 알기 위해 */
  const editBase = useRef({ updatedAt: current?.updatedAt ?? 0, files: draft.files });
  useEffect(() => {
    const prev = shown.current;
    if (prev.key !== baseKey && prev.id === selected && current && !same(draftRef.current, prev.draft)) {
      shown.current = { key: baseKey, id: selected, draft: toDraft(current) };
      return;
    }
    const next = current ? toDraft(current) : EMPTY;
    shown.current = { key: baseKey, id: selected, draft: next };
    editBase.current = { updatedAt: current?.updatedAt ?? 0, files: next.files };
    setDraft(next);
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 데스크톱: 페이지를 열 때 스킬 폴더에서 바뀐 내용을 읽어 온다
  useEffect(() => {
    void syncSkillFolders();
  }, []);

  const leave = async (): Promise<boolean> =>
    (!dirty && !aiBusy) || (await confirm({ title: '저장하지 않은 변경이 있어요', message: '변경 내용을 버릴까요?', confirmLabel: '버리기', tone: 'danger' }));

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

  const save = async () => {
    if (aiBusy) return;
    const next = { ...draft, name: normalizeSkillName(draft.name) };
    const p = validateSkill({ ...next, id: draft.id ?? '' }, skills) ?? validateSkillFiles(next.files);
    setProblem(p);
    if (p) return;
    // 편집하는 동안 폴더에서 이 스킬이 바뀌었으면 덮어쓰기 전에 묻는다
    if (
      current &&
      current.updatedAt !== editBase.current.updatedAt &&
      !(await confirm({
        title: '폴더에서 바뀐 내용이 있어요',
        message: '편집하는 동안 스킬 폴더에서 이 스킬이 바뀌었어요. 지금 편집 내용으로 덮어쓸까요? (폴더에 새로 넣은 파일은 그대로 둬요)',
        confirmLabel: '덮어쓰기',
        tone: 'danger',
      }))
    )
      return;
    const editedOut = editBase.current.files.map((f) => f.path).filter((path) => !next.files.some((f) => f.path.toLowerCase() === path.toLowerCase()));
    const options = makeSkillOptions(next.providerId, next.model, next.effort);
    const saved = useSkills.getState().save(
      {
      ...(next.id ? { id: next.id } : {}),
      name: next.name,
      title: next.title,
      description: next.description,
      prompt: next.prompt,
      files: next.files,
      ...(options ? { options } : {}),
      ...(current?.builtin ? { builtin: true } : {}),
      },
      editedOut,
    );
    // 저장본이 새 편집 기준
    editBase.current = { updatedAt: saved.updatedAt, files: saved.files ?? [] };
    shown.current = { key: `${saved.id}:${saved.updatedAt}`, id: saved.id, draft: toDraft(saved) };
    // 모바일은 저장 후 목록으로 돌아간다
    setSelected(mobile ? null : saved.id);
    setDraft(mobile ? EMPTY : toDraft(saved));
  };

  /** 저장된 스킬의 폴더를 연다. 새 스킬·저장 안 한 변경은 먼저 저장을 권한다 */
  const openFolder = async () => {
    if (!current) {
      setProblem(null);
      await confirm({ title: '먼저 저장하세요', message: '스킬을 저장하면 폴더가 만들어지고, 그 뒤에 열 수 있어요.', confirmLabel: '확인' });
      return;
    }
    if (dirty && !(await confirm({ title: '저장하지 않은 변경이 있어요', message: '폴더에는 저장된 내용만 있어요. 그대로 열까요?', confirmLabel: '열기' }))) return;
    try {
      await openSkillFolder(current);
    } catch (e) {
      await confirm({ title: '폴더를 열 수 없어요', message: e instanceof Error ? e.message : String(e), confirmLabel: '확인' });
    }
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

  /** PC 스킬을 받아 와 합친다 (명령 이름이 같으면 PC 내용으로) */
  const pullFromPc = async () => {
    if (!syncClient || pulling) return;
    setPulling(true);
    try {
      const r = await pullSkillsFromPc(() => syncClient!.pullSkills());
      const parts = [r.added && `${r.added}개 추가`, r.updated && `${r.updated}개 갱신`].filter(Boolean);
      pushNotice(
        parts.length ? `PC 스킬을 동기화했어요 (${parts.join(', ')})` : 'PC 스킬과 이미 같아요.',
      );
      if (r.skipped) pushNotice(`스킬은 ${SKILL_LIMITS.count}개까지라 ${r.skipped}개는 가져오지 못했어요.`);
    } catch (e) {
      pushNotice(`스킬을 동기화하지 못했어요. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setPulling(false);
    }
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
        {showList && skillFoldersAvailable && (
          <IconButton label="스킬 폴더 열기" title={skillFoldersRoot} onClick={() => void openSkillFolder()}>
            <FolderOpen size={18} />
          </IconButton>
        )}
        {showList && pcSkillSync && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} className={cn(pulling && 'animate-spin')} />}
            disabled={pulling || syncStatus !== 'online'}
            title={syncStatus === 'online' ? 'PC에서 만든 스킬을 받아 와요' : 'PC와 연결되면 동기화할 수 있어요'}
            onClick={() => void pullFromPc()}
          >
            동기화
          </Button>
        )}
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
                void save();
              }}
            >
              <div className="text-[13px] text-muted">
                {current ? (
                  <>
                    채팅 입력창에서 <code className="rounded bg-surface-2 px-1 text-accent">/{current.name}</code>을 입력하거나 <b className="font-medium text-fg-2">+ › 스킬</b>에서 고르면, 그 질문에 아래 지시가 더해져요.
                  </>
                ) : (
                  '새 스킬을 만들어요. 원하는 것을 AI에게 말하거나 아래 칸을 직접 채우세요. 명령 이름으로 채팅에서 바로 부를 수 있어요.'
                )}
              </div>

              <SkillAssist
                key={baseKey}
                draft={draft}
                onDraft={(f) => {
                  setDraft((d) => ({ ...d, ...f }));
                  setProblem(null);
                }}
                skills={skills}
                onBusy={setAiBusy}
                autoFocus={selected === 'new'}
              />

              <fieldset disabled={aiBusy} aria-busy={aiBusy} className="flex min-w-0 flex-col gap-4 disabled:opacity-70">
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

                <SkillFilesField
                  files={draft.files}
                  onChange={(files) => {
                    setDraft((d) => ({ ...d, files }));
                    setProblem(null);
                  }}
                  {...(skillFoldersAvailable
                    ? {
                        onOpenFolder: () => void openFolder(),
                        folderHint: current ? `${skillFoldersRoot}/${current.name} — 폴더에서 고친 내용은 앱으로 돌아오면 반영돼요` : '저장하면 스킬 폴더가 만들어져요',
                      }
                    : {})}
                />

                <SkillOptionsField value={draft} onChange={(o) => setDraft((d) => ({ ...d, ...o }))} />
              </fieldset>

              {problem && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {problem in PROBLEM_TEXT ? PROBLEM_TEXT[problem as SkillProblem] : FILES_TEXT[problem as SkillFilesProblem]}
                </p>
              )}

              <div className="safe-bottom flex items-center gap-2 pb-2">
                {current && (
                  <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Trash2 size={15} />} onClick={() => void remove()}>
                    삭제
                  </Button>
                )}
                <span className="flex-1" />
                {dirty && current && !aiBusy && (
                  <Button variant="ghost" disabled={aiBusy} onClick={() => setDraft(toDraft(current))}>
                    되돌리기
                  </Button>
                )}
                <Button type="submit" variant="primary" icon={<Save size={15} />} disabled={!dirty || aiBusy}>
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
