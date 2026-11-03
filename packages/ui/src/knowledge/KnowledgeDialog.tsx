import { t } from '../i18n';
import {
  cleanKnowledgeName,
  isKnowledgeLinkUrl,
  parseGitHubRepo,
  type KnowledgeAddResult,
  type KnowledgeBase,
  type KnowledgeEntry,
  type KnowledgePreview,
  type ID,
} from '@branch/core';
import { ArrowLeft, File, FileText, Folder, FolderOpen, Link2, Pencil, Plus, Trash2, Upload, X, GitBranch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { remoteMode } from '../app/capabilities';
import { actions, useApp } from '../app/store';
import { Button, IconButton } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { ipcErrorMessage, knowledgeApi } from './api';

export interface KnowledgeDialogProps {
  open: boolean;
  onClose(): void;
  sessionId: ID;
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

export function KnowledgeDialog({ open, onClose, sessionId }: KnowledgeDialogProps) {
  const api = knowledgeApi();
  const linkedId = useApp((s) => {
    const rootId = s.sessions[sessionId]?.rootId;
    return rootId ? s.sessions[rootId]?.knowledgeId : undefined;
  });
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tree, setTree] = useState<KnowledgeEntry[]>([]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const selectedRef = useRef<string | null>(null);

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
      .catch((e: unknown) => setNotice(withDetail(t('knowledge.error.generic'), e)))
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
      setNotice(withDetail(failure, e));
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const select = (id: string | null) => {
    selectedRef.current = id;
    setSelected(id);
    setTree([]);
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
    if (r.added.length) setNotice(t('knowledge.add.done', { count: r.added.length }));
    if (r.skipped) setNotice((prev) => [prev, t('knowledge.add.skipped', { count: r.skipped })].filter(Boolean).join(' '));
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

  const toggleLink = () => {
    if (!current) return;
    actions().setSessionKnowledge(sessionId, linkedId === current.id ? null : current.id);
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
    if (linkedId === current.id) actions().setSessionKnowledge(sessionId, null);
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
    // 처리 중에 또 놓으면 무시한다 (같은 파일이 겹쳐 들어가지 않게)
    if (!current || !api || busy) return;
    const id = current.id;
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    const paths: string[] = [];
    const blobs: { name: string; data: Uint8Array }[] = [];
    for (const f of files) {
      const p = api.pathForFile(f);
      if (p) paths.push(p);
      else blobs.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
    const results = await run(async () => {
      const out: KnowledgeAddResult[] = [];
      if (paths.length) out.push(await api.addPaths(id, paths));
      if (blobs.length) out.push(await api.addFiles(id, blobs));
      return out;
    }, t('knowledge.add.failed'));
    if (results) {
      report(merge(results));
      await refresh(id);
    }
  };

  const pickFiles = async () => {
    if (!current || !api) return;
    const id = current.id;
    const r = await run(() => api.pickFiles(id), t('knowledge.add.failed'));
    if (r) {
      report(r);
      await refresh(id);
    }
  };

  const addLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !api) return;
    const url = linkUrl.trim();
    if (!isKnowledgeLinkUrl(url)) return setNotice(t('knowledge.add.invalidUrl'));
    const id = current.id;
    const r = await run(() => api.addLink(id, url), t('knowledge.add.failed'));
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
    if (!repo) return setNotice(t('knowledge.add.invalidGit'));
    const id = current.id;
    const r = await run(() => api.cloneGit(id, repo.url), t('knowledge.add.failed'));
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
                      {b.id === linkedId && (
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
            <div className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
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
                    <Button size="sm" variant={current.id === linkedId ? 'secondary' : 'soft'} disabled={busy} onClick={toggleLink}>
                      {current.id === linkedId ? t('knowledge.list.unlink') : t('knowledge.list.link')}
                    </Button>
                    <IconButton size="sm" label={t('knowledge.rename.action')} disabled={busy} onClick={startRename}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton size="sm" label={t('knowledge.tree.open')} disabled={busy} onClick={() => openFolder()}>
                      <FolderOpen size={15} />
                    </IconButton>
                    <IconButton size="sm" label={t('knowledge.delete.action')} disabled={busy} onClick={removeBase} className="hover:text-danger">
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                )}
              </div>

              <div
                data-knowledge-drop=""
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => void addDropped(e)}
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
                {busy && <p className="text-[12px] text-fg-2">{t('knowledge.add.busy')}</p>}
              </div>

              {notice && (
                <p role="status" className="text-[13px] text-fg-2">
                  {notice}
                </p>
              )}

              <div className="flex flex-col gap-2">
                <h4 className="text-[13px] font-semibold text-fg-2">{t('knowledge.tree.heading')}</h4>
                {tree.length === 0 ? (
                  <p className="text-[13px] text-fg-2">{t('knowledge.tree.empty')}</p>
                ) : (
                  <ul aria-label={t('knowledge.tree.heading')} className="flex flex-col">
                    {tree.map((entry) => {
                      const depth = entry.path.split('/').length - 1;
                      const name = entry.path.split('/').pop() ?? entry.path;
                      const Icon = entry.dir ? Folder : name.match(/\.(md|txt)$/i) ? FileText : File;
                      return (
                        <li key={entry.path} data-entry={entry.path} className="group flex items-center gap-1 rounded-md py-0.5 pr-1 hover:bg-surface-2" style={{ paddingLeft: depth * 14 + 4 }}>
                          <Icon size={14} className="shrink-0 text-fg-2" />
                          {entry.dir ? (
                            <span className="min-w-0 flex-1 truncate text-[13px]" title={entry.path}>
                              {name}
                            </span>
                          ) : (
                            <button type="button" title={entry.path} onClick={() => void showPreview(entry)} className="min-w-0 flex-1 truncate text-left text-[13px] hover:text-accent">
                              {name}
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
    <Modal open={open} onClose={onClose} label={t('knowledge.dialog.title')} size="tall" className="md:max-w-4xl">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 truncate text-[16px] font-semibold">{t('knowledge.dialog.title')}</h2>
        <IconButton label={t('knowledge.dialog.close')} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      {body}
    </Modal>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-[14px] text-fg-2">{text}</p>;
}

/** 여러 번 나눠 넣은 결과를 하나로 합친다 */
function merge(results: KnowledgeAddResult[]): KnowledgeAddResult {
  return results.reduce<KnowledgeAddResult>((acc, r) => ({ added: [...acc.added, ...r.added], skipped: acc.skipped + r.skipped }), { added: [], skipped: 0 });
}
