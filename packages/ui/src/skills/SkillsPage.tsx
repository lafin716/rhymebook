import { t, tx, intlLocale } from '../i18n';
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
import { Badge } from '../components/Badge';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import { SkillAssist } from './SkillAssist';
import { SkillFilesField, SkillOptionsField, type OptionsDraft } from './SkillExtras';
import { openSkillFolder, pullSkillsFromPc, skillFoldersAvailable, skillFoldersRoot, syncSkillFolders, useSkills } from './skillsStore';

/** 웹·모바일: PC 스킬 동기화 버튼 (세션 창은 PC와 같은 스킬 DB를 쓰므로 필요 없다) */
const pcSkillSync = !!syncClient && !sessionWindowId;

/** 입력 문제별 안내 (렌더 시점에 번역한다) */
function problemMessage(problem: SkillProblem | SkillFilesProblem): string {
  switch (problem) {
    case 'name':
      return t('skills.problem.name', { max: SKILL_LIMITS.name });
    case 'name-taken':
      return t('skills.problem.nameTaken');
    case 'title':
      return t('skills.problem.title');
    case 'prompt':
      return t('skills.problem.prompt');
    case 'too-long':
      return t('skills.problem.tooLong', { title: SKILL_LIMITS.title, description: SKILL_LIMITS.description, prompt: SKILL_LIMITS.prompt });
    case 'path':
      return t('skills.files.path');
    case 'duplicate':
      return t('skills.files.duplicate');
    case 'count':
      return t('skills.files.count', { n: SKILL_FILE_LIMITS.count });
    case 'size':
      return t('skills.files.size', {
        file: SKILL_FILE_LIMITS.file.toLocaleString(intlLocale()),
        total: SKILL_FILE_LIMITS.total.toLocaleString(intlLocale()),
      });
  }
}

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
    (!dirty && !aiBusy) || (await confirm({ title: t('skills.page.unsavedTitle'), message: t('skills.page.discardMessage'), confirmLabel: t('skills.page.discard'), tone: 'danger' }));

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
        title: t('skills.page.folderChangedTitle'),
        message: t('skills.page.folderChangedMessage'),
        confirmLabel: t('skills.page.overwrite'),
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
      await confirm({ title: t('skills.page.saveFirstTitle'), message: t('skills.page.saveFirstMessage'), confirmLabel: t('skills.page.ok') });
      return;
    }
    if (dirty && !(await confirm({ title: t('skills.page.unsavedTitle'), message: t('skills.page.openUnsavedMessage'), confirmLabel: t('skills.page.open') }))) return;
    try {
      await openSkillFolder(current);
    } catch (e) {
      await confirm({ title: t('skills.page.folderOpenFailed'), message: e instanceof Error ? e.message : String(e), confirmLabel: t('skills.page.ok') });
    }
  };

  const remove = async () => {
    if (!current) return;
    const ok = await confirm({
      title: t('skills.page.deleteTitle'),
      message: t('skills.page.deleteMessage', { title: current.title, name: current.name }),
      confirmLabel: t('skills.page.delete'),
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
      const parts = [r.added && t('skills.page.addedCount', { n: r.added }), r.updated && t('skills.page.updatedCount', { n: r.updated })].filter(Boolean);
      pushNotice(
        parts.length ? t('skills.page.syncedNotice', { parts: parts.join(', ') }) : t('skills.page.syncSame'),
      );
      if (r.skipped) pushNotice(t('skills.page.skippedNotice', { max: SKILL_LIMITS.count, n: r.skipped }));
    } catch (e) {
      pushNotice(t('skills.page.syncFailed', { reason: e instanceof Error ? e.message : '' }).trim());
    } finally {
      setPulling(false);
    }
  };

  const showList = !mobile || selected === null;
  const showEditor = !mobile || selected !== null;

  return (
    <div role="dialog" aria-modal="true" aria-label={t('skills.page.title')} className="animate-fade-in fixed inset-0 z-[60] flex flex-col bg-bg pt-[env(safe-area-inset-top)]">
      <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-4">
        <IconButton label={mobile && selected !== null ? t('skills.page.list') : t('skills.page.back')} onClick={() => (mobile && selected !== null ? void pick(null) : void close())}>
          <ArrowLeft size={19} />
        </IconButton>
        <Sparkles size={17} className="text-accent" />
        <h2 className="flex-1 text-[16px] font-semibold">{t('skills.page.title')}</h2>
        {showList && skillFoldersAvailable && (
          <IconButton label={t('skills.page.openFolder')} title={skillFoldersRoot} onClick={() => void openSkillFolder()}>
            <FolderOpen size={18} />
          </IconButton>
        )}
        {showList && pcSkillSync && (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={14} className={cn(pulling && 'animate-spin')} />}
            disabled={pulling || syncStatus !== 'online'}
            title={syncStatus === 'online' ? t('skills.page.syncReady') : t('skills.page.syncOffline')}
            onClick={() => void pullFromPc()}
          >
            {t('skills.page.sync')}
          </Button>
        )}
        {showList && (
          <Button size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => void pick('new')}>
            {t('skills.page.new')}
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {showList && (
          <nav aria-label={t('skills.page.list')} className={cn('scroll-thin min-h-0 overflow-y-auto p-2', mobile ? 'flex-1' : 'w-72 shrink-0 border-r border-line bg-surface')}>
            {skills.length === 0 ? (
              <div className="px-3 py-8 text-center text-[13px] text-muted">
                <p>{t('skills.page.empty')}</p>
                <Button size="sm" variant="ghost" className="mt-2" icon={<RotateCcw size={14} />} onClick={() => useSkills.getState().restoreDefaults()}>
                  {t('skills.page.restoreExamples')}
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
                    {s.builtin && (
                      <Badge tone="neutral" className="ml-auto shrink-0 self-center">
                        {t('skills.page.builtin')}
                      </Badge>
                    )}
                  </div>
                  {s.description && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{s.description}</div>}
                </button>
              ))
            )}
          </nav>
        )}

        {showEditor && (
          <section aria-label={t('skills.page.editor')} className="scroll-thin min-h-0 min-w-0 flex-1 overflow-y-auto">
            <form
              className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-5 md:px-6"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <div className="text-[13px] text-muted">
                {current ? (
                  tx('skills.page.existingHint', {
                    command: <code className="rounded bg-surface-2 px-1 text-accent">/{current.name}</code>,
                    menu: <b className="font-medium text-fg-2">{t('skills.page.menuPath')}</b>,
                  })
                ) : (
                  t('skills.page.newHint')
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
                  <span className="text-[13px] font-medium text-fg-2">{t('skills.page.name')}</span>
                  <div className="flex h-10 items-center rounded-xl border border-line bg-surface px-3 focus-within:border-accent">
                    <span className="text-accent">/</span>
                    <input
                      value={draft.name}
                      maxLength={SKILL_LIMITS.name + 1}
                      placeholder="curriculum"
                      aria-label={t('skills.page.name')}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      onBlur={() => setDraft((d) => ({ ...d, name: normalizeSkillName(d.name) }))}
                      className="min-w-0 flex-1 bg-transparent pl-0.5 text-[14.5px] outline-none"
                    />
                  </div>
                </label>
  
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-fg-2">{t('skills.page.titleField')}</span>
                  <input
                    value={draft.title}
                    maxLength={SKILL_LIMITS.title}
                    placeholder={t('skills.page.titlePlaceholder')}
                    onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    className="h-10 rounded-xl border border-line bg-surface px-3 text-[14.5px] outline-none focus:border-accent"
                  />
                </label>
  
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-fg-2">{t('skills.page.description')} <span className="font-normal text-muted">{t('skills.page.descriptionHint')}</span></span>
                  <input
                    value={draft.description}
                    maxLength={SKILL_LIMITS.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="h-10 rounded-xl border border-line bg-surface px-3 text-[14.5px] outline-none focus:border-accent"
                  />
                </label>
  
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-baseline justify-between text-[13px] font-medium text-fg-2">
                    {t('skills.page.prompt')}
                    <span className="font-normal text-muted">
                      {draft.prompt.length.toLocaleString(intlLocale())} / {SKILL_LIMITS.prompt.toLocaleString(intlLocale())}
                    </span>
                  </span>
                  <textarea
                    value={draft.prompt}
                    maxLength={SKILL_LIMITS.prompt}
                    rows={16}
                    placeholder={t('skills.page.promptPlaceholder')}
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
                        folderHint: current ? t('skills.page.folderHintSaved', { root: skillFoldersRoot, name: current.name }) : t('skills.page.folderHintNew'),
                      }
                    : {})}
                />

                <SkillOptionsField value={draft} onChange={(o) => setDraft((d) => ({ ...d, ...o }))} />
              </fieldset>

              {problem && (
                <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                  {problemMessage(problem)}
                </p>
              )}

              <div className="safe-bottom flex items-center gap-2 pb-2">
                {current && (
                  <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" icon={<Trash2 size={15} />} onClick={() => void remove()}>
                    {t('skills.page.delete')}
                  </Button>
                )}
                <span className="flex-1" />
                {dirty && current && !aiBusy && (
                  <Button variant="ghost" disabled={aiBusy} onClick={() => setDraft(toDraft(current))}>
                    {t('skills.page.revert')}
                  </Button>
                )}
                <Button type="submit" variant="primary" icon={<Save size={15} />} disabled={!dirty || aiBusy}>
                  {t('skills.page.save')}
                </Button>
              </div>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
