import { t } from '../i18n';
import {
  cleanKnowledgeName,
  DEFAULT_RAG_SETTINGS,
  isKnowledgeLinkUrl,
  parseGitHubRepo,
  type KnowledgeAddResult,
  type KnowledgeBase,
  type KnowledgeEntry,
  type KnowledgePreview,
  type KnowledgeProgress,
  type ID,
} from '@branch/core';
import { ArrowLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, File, FileText, Folder, FolderOpen, Link2, Maximize2, Minimize2, Pencil, Plus, Settings2, SlidersHorizontal, Trash2, Upload, X, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { ipcErrorMessage, knowledgeApi } from './api';
import { IndexStatus } from './IndexStatus';
import { AutoIndexSwitch, KnowledgeInsights, KnowledgeSettingsDialog, RagSettingsDialog } from './KnowledgeInsights';
import { resetSessionKnowledge, toggleSessionKnowledge, useSessionKnowledge } from './sessionKnowledge';

export interface KnowledgeDialogProps {
  open: boolean;
  onClose(): void;
  sessionId: ID;
}

/** 안내 문구. 오류는 role=alert로 바로 읽히고 붉게 보인다 */
interface NoticeState {
  text: string;
  tone: 'info' | 'error';
}

/** 진행 중인 가져오기 (진행 막대에 보인다) */
type ImportKind = 'files' | 'link' | 'git';
interface ImportTask {
  kind: ImportKind;
  startedAt: number;
}

interface PreviewState {
  path: string;
  data: KnowledgePreview;
}

/**
 * 지식베이스 대화상자 (ADR-107). 데스크톱은 목록·상세 두 칸, 모바일은 목록 → 상세 순서로 보인다.
 * 연결은 학습(루트 세션)에 저장되므로 같은 학습의 가지도 같은 지식베이스를 쓴다.
 */
/** 실패 문구 뒤에 IPC가 준 원인 메시지를 덧붙인다 (접두어 제거) */
function withDetail(message: string, e: unknown): string {
  const detail = ipcErrorMessage(e);
  return detail ? `${message} (${detail})` : message;
}

/** 'main 브랜치만' 선택을 기억한다 */
/** 경로의 상위 폴더들 (a/b/c → a, a/b) */
function ancestors(p: string): string[] {
  const parts = p.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function KnowledgeDialog({ open, onClose, sessionId }: KnowledgeDialogProps) {
  const api = knowledgeApi();
  const { ids: linkedIds, inherited, overridden } = useSessionKnowledge(sessionId);
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const ragSettings = useApp((s) => s.settings.rag);
  const [tree, setTree] = useState<KnowledgeEntry[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [notice, setNoticeState] = useState<NoticeState | null>(null);
  const [task, setTask] = useState<ImportTask | null>(null);
  const [progress, setProgress] = useState<KnowledgeProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const cancelledRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);
  const [kbSettingsOpen, setKbSettingsOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false);
  /** 펼친 폴더 경로. 폴더는 처음에 접혀 있다 */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const selectedRef = useRef<string | null>(null);

  const setNotice = (text: string | null, tone: NoticeState['tone'] = 'info') => setNoticeState(text ? { text, tone } : null);
  const setError = (text: string) => setNotice(text, 'error');

  // 진행률 구독 (main이 가져오기 동안 보낸다)
  useEffect(() => {
    if (!open || !api?.onProgress) return;
    return api.onProgress((p) => setProgress(p));
  }, [open, api]);

  // 가져오는 동안 경과 시간을 1초마다 갱신한다
  useEffect(() => {
    if (!task) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [task]);

  const current = bases.find((b) => b.id === selected);
  const remote = remoteMode;

  const reload = useCallback(async () => {
    if (!api) return;
    setBases(await api.list());
  }, [api]);

  useEffect(() => {
    if (!open || remote || !api) return;
    setNotice(null);
    api
      .list()
      .then((list) => setBases(list))
      .catch((e: unknown) => setError(withDetail(t('knowledge.error.generic'), e)))
      .finally(() => setLoaded(true));
    // 대화상자를 열 때만 목록을 새로 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadTree = useCallback(
    async (id: string) => {
      if (!api) return;
      const entries = await api.tree(id);
      if (selectedRef.current === id) setTree(entries);
    },
    [api],
  );

  /** 작업을 실행한다. 바쁜 동안 버튼을 막고, 실패하면 안내 문구를 보인다 */
  const run = async <T,>(fn: () => Promise<T>, failure = t('knowledge.error.generic')): Promise<T | undefined> => {
    setBusy(true);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setError(withDetail(failure, e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  /** 가져오기: 진행 막대를 보이고, 사용자가 취소했으면 오류 대신 취소 안내를 보인다 */
  const runImport = async <T,>(kind: ImportKind, fn: () => Promise<T>): Promise<T | undefined> => {
    cancelledRef.current = false;
    setProgress(null);
    setTask({ kind, startedAt: Date.now() });
    setBusy(true);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      if (cancelledRef.current) setNotice(t('knowledge.progress.cancelled'));
      else setError(withDetail(t('knowledge.add.failed'), e));
      return undefined;
    } finally {
      setBusy(false);
      setTask(null);
      setProgress(null);
    }
  };

  const cancelImport = () => {
    if (!api?.cancel) return;
    cancelledRef.current = true;
    void api.cancel().catch(() => undefined);
  };

  const select = (id: string | null) => {
    selectedRef.current = id;
    setSelected(id);
    setTree([]);
    setExpanded(new Set());
    setPreview(null);
    setRenaming(false);
    setCreating(false);
    setNotice(null);
    if (id) void run(() => loadTree(id));
  };

  // void를 돌려주는 API는 run()의 undefined가 실패로 읽히지 않도록 성공 여부를 따로 본다
  const runVoid = async (fn: () => Promise<void>, failure?: string): Promise<boolean> =>
    (await run(async () => {
      await fn();
      return true;
    }, failure)) === true;

  const refresh = async (id: string) => {
    await loadTree(id);
    await reload();
  };

  const report = (r: KnowledgeAddResult | undefined) => {
    if (!r) return;
    const parts = [r.added.length ? t('knowledge.add.done', { count: r.added.length }) : '', r.skipped ? t('knowledge.add.skipped', { count: r.skipped }) : ''];
    const text = parts.filter(Boolean).join(' ');
    // 새로 넣은 항목이 보이도록 상위 폴더를 펼친다
    if (r.added.length) setExpanded((prev) => new Set([...prev, ...r.added.flatMap(ancestors)]));
    // 하나도 못 넣었으면 그대로 넘어가지 않고 알린다
    setNotice(text || t('knowledge.add.nothing'), r.added.length ? 'info' : 'error');
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    const name = cleanKnowledgeName(draftName);
    if (!name || !api) return;
    const kb = await run(() => api.create(name));
    if (!kb) return;
    setDraftName('');
    await reload();
    select(kb.id);
  };

  const submitRename = async (e: FormEvent) => {
    e.preventDefault();
    const name = cleanKnowledgeName(draftName);
    if (!name || !current || !api) return;
    const done = await run(() => api.rename(current.id, name));
    if (!done) return;
    setRenaming(false);
    await reload();
  };

  const isLinked = !!current && linkedIds.includes(current.id);

  const toggleLink = () => {
    if (!current) return;
    toggleSessionKnowledge(sessionId, linkedIds, current.id);
  };

  const removeBase = async () => {
    if (!current || !api) return;
    const ok = await confirm({
      title: t('knowledge.delete.title', { name: current.name }),
      message: t('knowledge.delete.message', { count: current.fileCount }),
      confirmLabel: t('knowledge.delete.confirm'),
      tone: 'danger',
    });
    if (!ok) return;
    if (linkedIds.includes(current.id)) toggleSessionKnowledge(sessionId, linkedIds, current.id);
    if (!(await runVoid(() => api.remove(current.id)))) return;
    select(null);
    await reload();
  };

  const removeEntry = async (entry: KnowledgeEntry) => {
    if (!current || !api) return;
    const name = entry.path.split('/').pop() ?? entry.path;
    const ok = await confirm({
      title: t('knowledge.tree.removeTitle', { name }),
      message: t('knowledge.tree.removeMessage'),
      confirmLabel: t('knowledge.tree.remove'),
      tone: 'danger',
    });
    if (!ok) return;
    if (preview?.path === entry.path) setPreview(null);
    if (await runVoid(() => api.removeEntry(current.id, entry.path))) await refresh(current.id);
  };

  const showPreview = async (entry: KnowledgeEntry) => {
    if (!current || !api) return;
    const data = await run(() => api.preview(current.id, entry.path));
    if (data) setPreview({ path: entry.path, data });
  };

  /** 끌어다 놓은 항목: 경로를 얻으면 디스크에서 복사하고, 못 얻으면 내용으로 넣는다 */
  const addDropped = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!current || !api) return;
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return setError(t('knowledge.add.dropEmpty'));
    // 처리 중에 또 놓으면 넣지 않고 알린다 (같은 파일이 겹쳐 들어가지 않게)
    if (busy) return setError(t('knowledge.add.busyDrop'));
    const id = current.id;
    const results = await runImport('files', async () => {
      const paths: string[] = [];
      const blobs: { name: string; data: Uint8Array }[] = [];
      for (const f of files) {
        const p = api.pathForFile(f);
        if (p) paths.push(p);
        else blobs.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
      }
      const out: KnowledgeAddResult[] = [];
      if (paths.length) out.push(await api.addPaths(id, paths));
      if (blobs.length) out.push(await api.addFiles(id, blobs));
      return out;
    });
    if (results) {
      report(merge(results));
      await refresh(id);
    }
  };

  const pickFiles = async () => {
    if (!current || !api) return;
    const id = current.id;
    const r = await runImport('files', () => api.pickFiles(id));
    if (r) {
      report(r);
      await refresh(id);
    }
  };

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !api) return;
    const url = linkUrl.trim();
    if (!isKnowledgeLinkUrl(url)) return setError(t('knowledge.add.invalidUrl'));
    const id = current.id;
    const r = await runImport('link', () => api.addLink(id, url));
    if (r) {
      setLinkUrl('');
      report(r);
      await refresh(id);
    }
  };

  const addGit = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !api) return;
    const repo = parseGitHubRepo(gitUrl);
    if (!repo) return setError(t('knowledge.add.invalidGit'));
    const id = current.id;
    const r = await runImport('git', () => api.cloneGit(id, repo.url));
    if (r) {
      setGitUrl('');
      report(r);
      await refresh(id);
    }
  };

  const openFolder = (path?: string) => {
    if (!current || !api) return;
    void run(() => api.open(current.id, path));
  };

  const startRename = () => {
    if (!current) return;
    setDraftName(current.name);
    setRenaming(true);
  };

  const dirs = tree.filter((e) => e.dir).map((e) => e.path);
  const allOpen = dirs.length > 0 && dirs.every((d) => expanded.has(d));
  // 접힌 폴더 안의 항목은 숨긴다
  const visibleTree = tree.filter((e) => ancestors(e.path).every((a) => expanded.has(a)));
  const toggleDir = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const body = (() => {
    if (remote) return <Notice text={t('knowledge.remote.notice')} />;
    if (!api) return <Notice text={t('knowledge.unavailable.notice')} />;
    return (
      <div className="flex min-h-0 flex-1">
        <aside className={cn('w-full shrink-0 flex-col border-line md:w-72 md:border-r', selected ? 'hidden md:flex' : 'flex')}>
          <div className="flex items-center gap-2 px-4 pt-4 pb-2">
            <h3 className="flex-1 text-[13px] font-semibold text-fg-2">{t('knowledge.list.heading')}</h3>
            <Button size="sm" variant="soft" icon={<Plus size={14} />} disabled={busy} onClick={() => setCreating((v) => !v)}>
              {t('knowledge.list.create')}
            </Button>
            <IconButton size="sm" label={t('knowledge.rag.open')} onClick={() => setRagOpen(true)}>
              <SlidersHorizontal size={15} />
            </IconButton>
          </div>
          {creating && (
            <form onSubmit={submitCreate} className="flex flex-col gap-2 px-4 pb-3">
              <input
                autoFocus
                aria-label={t('knowledge.create.title')}
                value={draftName}
                maxLength={80}
                placeholder={t('knowledge.create.namePlaceholder')}
                onChange={(e) => setDraftName(e.target.value)}
                className="h-9 rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  {t('knowledge.create.cancel')}
                </Button>
                <Button size="sm" variant="primary" type="submit" disabled={busy || !cleanKnowledgeName(draftName)}>
                  {t('knowledge.create.submit')}
                </Button>
              </div>
            </form>
          )}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {loaded && bases.length === 0 && (
              <div className="px-2 py-6 text-center">
                <p className="text-[14px] font-medium text-fg">{t('knowledge.list.empty')}</p>
                <p className="mt-1 text-[13px] text-fg-2">{t('knowledge.list.emptyHint')}</p>
                <Button className="mt-4" variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  {t('knowledge.list.create')}
                </Button>
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {bases.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-current={b.id === selected ? 'true' : undefined}
                    onClick={() => select(b.id)}
                    className={cn(
                      'flex w-full min-w-0 flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors',
                      b.id === selected ? 'bg-accent-soft text-accent' : 'text-fg hover:bg-surface-2',
                    )}
                  >
                    <span className="flex w-full min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{b.name}</span>
                      {linkedIds.includes(b.id) && (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[11px] font-medium text-accent-fg">
                          {t('knowledge.list.linkedBadge')}
                        </span>
                      )}
                    </span>
                    <span className="text-[12px] text-fg-2">{t('knowledge.list.count', { count: b.fileCount })}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <section className={cn('min-h-0 min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden md:flex')}>
          {!current ? (
            <div className="flex flex-1 items-center justify-center p-6 text-[14px] text-fg-2">{loaded && bases.length ? t('knowledge.tree.previewEmpty') : null}</div>
          ) : (
            <div
              className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
              }}
              onDrop={(e) => void addDropped(e)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <IconButton size="sm" label={t('knowledge.dialog.back')} className="md:hidden" onClick={() => select(null)}>
                  <ArrowLeft size={16} />
                </IconButton>
                {renaming ? (
                  <form onSubmit={submitRename} className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      autoFocus
                      aria-label={t('knowledge.rename.action')}
                      value={draftName}
                      maxLength={80}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[14px] outline-none focus:border-accent"
                    />
                    <Button size="sm" variant="primary" type="submit" disabled={busy || !cleanKnowledgeName(draftName)}>
                      {t('knowledge.rename.submit')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
                      {t('knowledge.rename.cancel')}
                    </Button>
                  </form>
                ) : (
                  <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{current.name}</h3>
                )}
                {!renaming && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant={isLinked ? 'secondary' : 'soft'} disabled={busy} onClick={toggleLink}>
                      {isLinked ? t('knowledge.list.unlink') : t('knowledge.list.link')}
                    </Button>
                    <IconButton size="sm" label={t('knowledge.rename.action')} disabled={busy} onClick={startRename}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton size="sm" label={t('knowledge.tree.open')} disabled={busy} onClick={() => openFolder()}>
                      <FolderOpen size={15} />
                    </IconButton>
                    <IconButton size="sm" label={t('knowledge.settings.open')} onClick={() => setKbSettingsOpen(true)}>
                      <Settings2 size={15} />
                    </IconButton>
                    <IconButton size="sm" label={t('knowledge.delete.action')} disabled={busy} onClick={removeBase} className="hover:text-danger">
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                )}
                {!renaming && (
                  <div className="ml-auto border-line pl-1 md:ml-2 md:border-l md:pl-3">
                    <AutoIndexSwitch kbId={current.id} />
                  </div>
                )}
              </div>

              {(inherited || overridden) && (
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-2" data-link-scope={inherited ? 'inherited' : 'overridden'}>
                  <span>{inherited ? t('knowledge.link.inherited') : t('knowledge.link.overridden')}</span>
                  {overridden && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => resetSessionKnowledge(sessionId)}>
                      {t('knowledge.link.reset')}
                    </Button>
                  )}
                </div>
              )}

              <IndexStatus kbId={current.id} />

              <KnowledgeInsights kbId={current.id} revision={tree} onChanged={() => void refresh(current.id)} />

              <div
                data-knowledge-drop=""
                className={cn(
                  'flex flex-col gap-3 rounded-xl border border-dashed border-line p-3 transition-colors',
                  dragOver && 'border-accent bg-accent-soft',
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Upload size={15} className="text-fg-2" />
                  <span className="min-w-0 flex-1 text-[13px] text-fg-2">{t('knowledge.add.drop')}</span>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void pickFiles()}>
                    {t('knowledge.add.pick')}
                  </Button>
                </div>
                <form onSubmit={addLink} className="flex items-center gap-2">
                  <Link2 size={15} className="shrink-0 text-fg-2" />
                  <input
                    aria-label={t('knowledge.add.linkLabel')}
                    value={linkUrl}
                    placeholder={t('knowledge.add.linkPlaceholder')}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent"
                  />
                  <Button size="sm" variant="secondary" type="submit" disabled={busy || !linkUrl.trim()}>
                    {t('knowledge.add.linkSubmit')}
                  </Button>
                </form>
                <form onSubmit={addGit} className="flex items-center gap-2">
                  <GitBranch size={15} className="shrink-0 text-fg-2" />
                  <input
                    aria-label={t('knowledge.add.gitLabel')}
                    value={gitUrl}
                    placeholder={t('knowledge.add.gitPlaceholder')}
                    onChange={(e) => setGitUrl(e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent"
                  />
                  <Button size="sm" variant="secondary" type="submit" disabled={busy || !gitUrl.trim()}>
                    {t('knowledge.add.gitSubmit')}
                  </Button>
                </form>
                <p data-git-hint className="pl-[23px] text-[12px] text-fg-2">{t('knowledge.add.gitHint')}</p>
                {task && <ImportProgress task={task} progress={progress} now={now} onCancel={api.cancel ? cancelImport : undefined} />}
              </div>

              {notice && (
                <p
                  role={notice.tone === 'error' ? 'alert' : 'status'}
                  className={cn('rounded-lg px-3 py-2 text-[13px]', notice.tone === 'error' ? 'bg-danger-soft text-danger' : 'text-fg-2')}
                >
                  {notice.text}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="flex-1 text-[13px] font-semibold text-fg-2">{t('knowledge.tree.heading')}</h4>
                  {dirs.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />}
                      onClick={() => setExpanded(allOpen ? new Set() : new Set(dirs))}
                    >
                      {allOpen ? t('knowledge.tree.collapseAll') : t('knowledge.tree.expandAll')}
                    </Button>
                  )}
                </div>
                {tree.length === 0 ? (
                  <p className="text-[13px] text-fg-2">{t('knowledge.tree.empty')}</p>
                ) : (
                  <ul aria-label={t('knowledge.tree.heading')} className="flex flex-col">
                    {visibleTree.map((entry) => {
                      const depth = entry.path.split('/').length - 1;
                      const name = entry.path.split('/').pop() ?? entry.path;
                      const open = entry.dir && expanded.has(entry.path);
                      const Icon = entry.dir ? (open ? FolderOpen : Folder) : name.match(/\.(md|txt)$/i) ? FileText : File;
                      return (
                        <li key={entry.path} data-entry={entry.path} className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-surface-2" style={{ paddingLeft: depth * 14 + 4 }}>
                          {entry.dir ? (
                            <button
                              type="button"
                              aria-expanded={open}
                              title={entry.path}
                              onClick={() => toggleDir(entry.path)}
                              className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] hover:text-accent"
                            >
                              <ChevronRight size={13} className={cn('shrink-0 text-fg-2 transition-transform', open && 'rotate-90')} />
                              <Icon size={14} className="shrink-0 text-fg-2" />
                              <span className="min-w-0 flex-1 truncate">{name}</span>
                            </button>
                          ) : (
                            <button type="button" title={entry.path} onClick={() => void showPreview(entry)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-[13px] hover:text-accent">
                              <span className="w-[13px] shrink-0" />
                              <Icon size={14} className="shrink-0 text-fg-2" />
                              <span className="min-w-0 flex-1 truncate">{name}</span>
                            </button>
                          )}
                          {entry.dir && (
                            <IconButton size="sm" label={t('knowledge.tree.open')} disabled={busy} onClick={() => openFolder(entry.path)} className="size-6 opacity-70 hover:opacity-100">
                              <FolderOpen size={13} />
                            </IconButton>
                          )}
                          <IconButton size="sm" label={`${t('knowledge.tree.remove')}: ${name}`} disabled={busy} onClick={() => void removeEntry(entry)} className="size-6 opacity-70 hover:text-danger hover:opacity-100">
                            <X size={13} />
                          </IconButton>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {preview && (
                <div className="flex flex-col gap-2">
                  <h4 className="truncate text-[13px] font-semibold text-fg-2">{preview.path}</h4>
                  {preview.data.text === null ? (
                    <p className="text-[13px] text-fg-2">{t('knowledge.tree.binary')}</p>
                  ) : (
                    <>
                      {preview.data.truncated && <p className="text-[12px] text-fg-2">{t('knowledge.tree.truncated')}</p>}
                      <pre className="scroll-thin max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed whitespace-pre-wrap text-fg">
                        {preview.data.text}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    );
  })();

  return (
    <Modal open={open} onClose={onClose} label={t('knowledge.dialog.title')} size={full ? 'full' : 'tall'} className="md:max-w-4xl">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 truncate text-[16px] font-semibold">{t('knowledge.dialog.title')}</h2>
        <IconButton label={full ? t('knowledge.dialog.exitFull') : t('knowledge.dialog.full')} aria-pressed={full} className="max-md:hidden" onClick={() => setFull((v) => !v)}>
          {full ? <Minimize2 size={17} /> : <Maximize2 size={16} />}
        </IconButton>
        <IconButton label={t('knowledge.dialog.close')} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {body}
      <RagSettingsDialog
        open={ragOpen}
        onClose={() => setRagOpen(false)}
        value={{ ...DEFAULT_RAG_SETTINGS, ...ragSettings }}
        onSave={(next) => actions().updateSettings({ rag: next })}
      />
      {current && (
        <KnowledgeSettingsDialog
          open={kbSettingsOpen}
          onClose={() => setKbSettingsOpen(false)}
          kbId={current.id}
          name={current.name}
          description={(current as { description?: string }).description}
          onChanged={() => void refresh(current.id)}
        />
      )}
    </Modal>
  );
}

/** 가져오기 진행 막대. 비율을 알면 채워지고, 모르면 움직이는 막대를 보인다 */
function ImportProgress({ task, progress, now, onCancel }: { task: ImportTask; progress: KnowledgeProgress | null; now: number; onCancel?: () => void }) {
  const ratio = progress?.ratio;
  const percent = ratio === undefined ? undefined : Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  const phase = progress?.phase ?? (task.kind === 'git' ? 'clone' : task.kind === 'link' ? 'download' : 'copy');
  let label: string;
  if (phase === 'copy') label = progress?.files ? t('knowledge.progress.copied', { count: progress.files, size: formatBytes(progress.bytes ?? 0) }) : t('knowledge.progress.copy');
  else label = t(`knowledge.progress.${phase}`);
  if (percent !== undefined) label = `${label} ${percent}%`;
  const seconds = Math.max(0, Math.floor((now - task.startedAt) / 1000));
  return (
    <div className="flex flex-col gap-1.5" data-knowledge-progress="">
      <div className="flex items-center gap-2 text-[12px] text-fg-2">
        <span className="min-w-0 flex-1 truncate" aria-live="polite">
          {label}
        </span>
        <span className="shrink-0 tabular-nums">{t('knowledge.progress.elapsed', { seconds })}</span>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('knowledge.progress.cancel')}
          </Button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={t('knowledge.progress.label')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="relative h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        {percent === undefined ? (
          <div className="kb-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${percent}%` }} />
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Notice({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[14px] text-fg-2">{text}</p>;
}

/** 여러 번 나눠 넣은 결과를 하나로 합친다 */
function merge(results: KnowledgeAddResult[]): KnowledgeAddResult {
  return results.reduce<KnowledgeAddResult>((acc, r) => ({ added: [...acc.added, ...r.added], skipped: acc.skipped + r.skipped }), { added: [], skipped: 0 });
}
