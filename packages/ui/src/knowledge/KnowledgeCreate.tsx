import {
  cleanExcludes,
  cleanKnowledgeName,
  DEFAULT_CODEBASE_EXCLUDES,
  NEW_DOCUMENT_INDEX_SETTINGS,
  parseGitHubRepo,
  type DesktopKnowledgeApi,
  type KnowledgeAddResult,
  type KnowledgeBase,
  type KnowledgeFolderInspection,
  type KnowledgeIndexSettings,
  type KnowledgeKind,
  type KnowledgeProgress,
} from '@branch/core';
import { ArrowLeft, Code2, FileText, FolderOpen, GitBranch, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { t } from '../i18n';
import { Button, IconButton } from '../components/Button';
import { cn } from '../lib/cn';
import { ipcErrorMessage } from './api';
import { kbErrorGuide } from './kbErrors';
import { defaultNameFromGit, findDuplicates, formatSize } from './kbModel';

type Step = 'kind' | 'codebase' | 'document';
type EmbeddingProvider = KnowledgeIndexSettings['embedding']['provider'];

export interface KnowledgeCreateProps {
  api: DesktopKnowledgeApi;
  /** 만들어진 지식베이스. notice가 있으면 만들었지만 일부가 실패한 것이다 */
  onCreated(kb: KnowledgeBase, notice?: string): void;
  onCancel(): void;
}

/** 문서형 파일 한 개 (아직 KB에 넣지 않은 상태) */
interface StagedFile {
  key: string;
  name: string;
  size: number;
  file?: File;
  path?: string;
}

let stagedSeq = 0;

/**
 * 단계형 지식베이스 등록 (T4). 1단계: 유형 고르기 → 2단계: 유형별 입력 → 제출.
 * 코드베이스는 색인 옵션이 없고, 문서는 간단한 색인 방식(기본 로컬 의미 검색)을 고른다.
 */
export function KnowledgeCreate({ api, onCreated, onCancel }: KnowledgeCreateProps) {
  const [step, setStep] = useState<Step>('kind');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<KnowledgeProgress | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!busy || !api.onProgress) return;
    return api.onProgress((p) => setProgress(p));
  }, [busy, api]);

  const pickKind = (kind: KnowledgeKind) => {
    setError(null);
    setStep(kind);
  };

  const back = () => {
    setError(null);
    setStep('kind');
  };

  /** 생성 흐름 공통: 실패하면 KB가 남았는지에 따라 메시지를 고른다 */
  const fail = (message: string, e: unknown) => {
    const guide = kbErrorGuide(e, t);
    if (guide) {
      setError(`${message} ${guide}`);
      return;
    }
    const detail = ipcErrorMessage(e);
    setError(detail ? `${message} (${detail})` : message);
  };

  return (
    <section aria-label={t('knowledge.create.title')} className="scroll-thin flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4" data-create-step={step}>
      <div className="flex items-center gap-2">
        {step !== 'kind' ? (
          <IconButton size="sm" label={t('knowledge.create.back')} disabled={busy} onClick={back}>
            <ArrowLeft size={16} />
          </IconButton>
        ) : null}
        <h3 className="flex-1 text-[15px] font-semibold text-fg">{step === 'kind' ? t('knowledge.create.kindTitle') : t(`knowledge.create.kind.${step}.title`)}</h3>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('knowledge.create.cancel')}
        </Button>
      </div>

      {step === 'kind' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <KindCard kind="codebase" onPick={() => pickKind('codebase')} />
          <KindCard kind="document" onPick={() => pickKind('document')} />
        </div>
      )}

      {step === 'codebase' && (
        <CodebaseForm
          api={api}
          busy={busy}
          setBusy={setBusy}
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          onError={(msg, e) => fail(msg, e)}
          clearError={() => setError(null)}
          onDone={onCreated}
        />
      )}

      {step === 'document' && (
        <DocumentForm
          api={api}
          busy={busy}
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          onStart={() => {
            cancelledRef.current = false;
            setProgress(null);
            setError(null);
            setBusy(true);
          }}
          onEnd={() => {
            setBusy(false);
            setProgress(null);
          }}
          cancelledRef={cancelledRef}
          onError={(msg, e) => fail(msg, e)}
          onDone={onCreated}
        />
      )}

      {busy && (
        <div className="flex flex-col gap-1.5" data-knowledge-create-progress="">
          <div className="flex items-center gap-2 text-[12px] text-fg-2">
            <span className="min-w-0 flex-1 truncate" aria-live="polite">
              {progress?.phase ? t(`knowledge.progress.${progress.phase}`) : t('knowledge.create.working')}
            </span>
            {api.cancel && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  cancelledRef.current = true;
                  void api.cancel?.().catch(() => undefined);
                }}
              >
                {t('knowledge.progress.cancel')}
              </Button>
            )}
          </div>
          <div
            role="progressbar"
            aria-label={t('knowledge.progress.label')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress?.ratio === undefined ? undefined : Math.round(progress.ratio * 100)}
            className="relative h-1.5 overflow-hidden rounded-full bg-surface-2"
          >
            {progress?.ratio === undefined ? (
              <div className="kb-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-accent" />
            ) : (
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            )}
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function KindCard({ kind, onPick }: { kind: KnowledgeKind; onPick(): void }) {
  const Icon = kind === 'codebase' ? Code2 : FileText;
  return (
    <button
      type="button"
      onClick={onPick}
      data-kind-card={kind}
      className="flex w-full flex-col items-start gap-2 rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon size={18} />
      </span>
      <span className="text-[15px] font-semibold text-fg">{t(`knowledge.kind.${kind}`)}</span>
      <span className="text-[13px] leading-relaxed text-fg-2">{t(`knowledge.create.kind.${kind}.desc`)}</span>
    </button>
  );
}

interface CodebaseFormProps {
  api: DesktopKnowledgeApi;
  busy: boolean;
  setBusy(v: boolean): void;
  name: string;
  setName(v: string): void;
  description: string;
  setDescription(v: string): void;
  onError(message: string, e: unknown): void;
  clearError(): void;
  onDone(kb: KnowledgeBase, notice?: string): void;
}

/** 코드베이스: 로컬 폴더(읽기 전용 연결) 또는 GitHub 저장소. 색인 옵션은 없다. */
function CodebaseForm({ api, busy, setBusy, name, setName, description, setDescription, onError, clearError, onDone }: CodebaseFormProps) {
  const [path, setPath] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [inspection, setInspection] = useState<KnowledgeFolderInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [excludesText, setExcludesText] = useState(() => DEFAULT_CODEBASE_EXCLUDES.join('\n'));
  const nameTouched = useRef(false);

  const inspect = async (p: string) => {
    const target = p.trim();
    if (!target || !api.inspectFolder) return;
    setInspecting(true);
    try {
      const r = await api.inspectFolder(target);
      setInspection(r);
      setPath(r.path);
      if (!nameTouched.current && r.name) setName(r.name);
    } catch (e) {
      setInspection(null);
      onError(t('knowledge.create.codebase.inspectFailed'), e);
    } finally {
      setInspecting(false);
    }
  };

  const pick = async () => {
    if (!api.pickFolder) return;
    const p = await api.pickFolder().catch((e: unknown) => {
      onError(t('knowledge.error.generic'), e);
      return null;
    });
    if (p) {
      setGitUrl('');
      await inspect(p);
    }
  };

  const gitRepo = gitUrl.trim() ? parseGitHubRepo(gitUrl) : null;
  const hasSource = !!path.trim() || !!gitRepo;
  const canSubmit = !busy && !!cleanKnowledgeName(name) && hasSource && (!gitUrl.trim() || !!gitRepo);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const finalName = cleanKnowledgeName(name);
    if (!finalName || !hasSource) return;
    clearError();
    setBusy(true);
    try {
      const excludes = cleanExcludes(excludesText.split('\n'));
      const linkedPath = gitRepo ? undefined : path.trim();
      const kb = await api.create(finalName, { kind: 'codebase', description: description.trim() || undefined, linkedPath, excludes });
      if (gitRepo) {
        try {
          await api.cloneGit(kb.id, gitRepo.url);
        } catch {
          // 폴더 연결까지는 끝났으니 KB는 남기고 클론 실패를 알린다
          onDone(kb, t('knowledge.create.codebase.cloneFailed'));
          return;
        }
      }
      onDone(kb);
    } catch (err) {
      onError(t('knowledge.create.failed'), err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-codebase-form="">
      <p role="note" className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-fg">
        {t('knowledge.create.codebase.notice')}
      </p>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.codebase.source')}</span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={t('knowledge.create.codebase.pathLabel')}
            value={path}
            placeholder={t('knowledge.create.codebase.pathPlaceholder')}
            disabled={busy || !!gitUrl.trim()}
            onChange={(e) => setPath(e.target.value)}
            onBlur={() => path.trim() && !inspection && void inspect(path)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void inspect(path);
              }
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent disabled:opacity-50"
          />
          {api.pickFolder && (
            <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} disabled={busy || !!gitUrl.trim()} onClick={() => void pick()}>
              {t('knowledge.create.codebase.pickFolder')}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GitBranch size={15} className="shrink-0 text-fg-2" />
          <input
            aria-label={t('knowledge.create.codebase.gitLabel')}
            value={gitUrl}
            placeholder={t('knowledge.create.codebase.gitPlaceholder')}
            disabled={busy || !!path.trim()}
            onChange={(e) => {
              setGitUrl(e.target.value);
              const repo = parseGitHubRepo(e.target.value);
              if (repo && !nameTouched.current) setName(defaultNameFromGit(e.target.value));
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent disabled:opacity-50"
          />
        </div>
        {gitUrl.trim() && !gitRepo && <p className="text-[12px] text-danger">{t('knowledge.add.invalidGit')}</p>}
        {gitRepo && <p className="text-[12px] text-fg-2">{t('knowledge.create.codebase.gitHint')}</p>}
        {inspecting && <p className="text-[12px] text-fg-2">{t('knowledge.create.codebase.inspecting')}</p>}
        {inspection && !gitRepo && (
          <div data-inspection="" className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px] text-fg-2">
            <p className="font-medium text-fg">{t('knowledge.create.codebase.inspected', { count: inspection.fileCount, size: formatSize(inspection.totalBytes) })}</p>
            {inspection.truncated && <p>{t('knowledge.create.codebase.truncated')}</p>}
            {inspection.isGitRepo && <p>{t('knowledge.create.codebase.isGit')}</p>}
            {inspection.suggestedKind === 'document' && <p className="text-warn">{t('knowledge.create.codebase.suggestDocument')}</p>}
            {inspection.top.length > 0 && (
              <p className="truncate font-mono text-[11.5px]">{inspection.top.slice(0, 8).map((e) => e.path).join('  ·  ')}</p>
            )}
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.name')}</span>
        <input
          aria-label={t('knowledge.create.title')}
          value={name}
          maxLength={80}
          placeholder={t('knowledge.create.namePlaceholder')}
          disabled={busy}
          onChange={(e) => {
            nameTouched.current = true;
            setName(e.target.value);
          }}
          className="h-9 rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.description')}</span>
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          disabled={busy}
          placeholder={t('knowledge.create.codebase.descPlaceholder')}
          onChange={(e) => setDescription(e.target.value)}
          className="scroll-thin resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.codebase.excludes')}</span>
        <textarea
          value={excludesText}
          rows={5}
          disabled={busy}
          onChange={(e) => setExcludesText(e.target.value)}
          className="scroll-thin resize-y rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
        />
        <span className="text-[12px] text-fg-2">{t('knowledge.create.codebase.excludesHint')}</span>
      </label>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {t('knowledge.create.codebase.submit')}
        </Button>
      </div>
    </form>
  );
}

interface DocumentFormProps {
  api: DesktopKnowledgeApi;
  busy: boolean;
  name: string;
  setName(v: string): void;
  description: string;
  setDescription(v: string): void;
  onStart(): void;
  onEnd(): void;
  cancelledRef: { current: boolean };
  onError(message: string, e: unknown): void;
  onDone(kb: KnowledgeBase, notice?: string): void;
}

/** 문서: 파일이나 폴더를 고르거나 끌어다 놓는다. 목록 안 중복은 한 번만 넣는다. */
function DocumentForm({ api, busy, name, setName, description, setDescription, onStart, onEnd, cancelledRef, onError, onDone }: DocumentFormProps) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<EmbeddingProvider>(NEW_DOCUMENT_INDEX_SETTINGS.embedding.provider);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const addStaged = (items: Omit<StagedFile, 'key'>[]) => {
    const incoming: StagedFile[] = items.map((i) => ({ ...i, key: `s${++stagedSeq}` }));
    // 목록 안에서 이름+크기가 같은 파일은 한 번만 넣는다 (크기 0 항목은 폴더일 수 있어 비교하지 않는다)
    const comparable = incoming.filter((i) => i.size > 0);
    const { duplicates } = findDuplicates(comparable, staged);
    const dupKeys = new Set(duplicates.map((d) => d.key));
    const fresh = incoming.filter((i) => !dupKeys.has(i.key));
    setStaged((prev) => [...prev, ...fresh]);
    setNotice(duplicates.length ? t('knowledge.create.document.duplicates', { count: duplicates.length }) : null);
  };

  const fromFiles = (list: FileList | File[]) => {
    const items = Array.from(list).map((f) => ({ name: f.name, size: f.size, file: f, path: api.pathForFile(f) || undefined }));
    if (items.length) addStaged(items);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (busy) return;
    if (!e.dataTransfer.files.length) return setNotice(t('knowledge.add.dropEmpty'));
    fromFiles(e.dataTransfer.files);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const finalName = cleanKnowledgeName(name);
    if (!finalName) return;
    onStart();
    let kb: KnowledgeBase | undefined;
    try {
      const made = await api.create(finalName, { kind: 'document', description: description.trim() || undefined });
      kb = made;
      const embedding: KnowledgeIndexSettings['embedding'] = { provider };
      if (api.setIndexSettings) await api.setIndexSettings(made.id, { ...NEW_DOCUMENT_INDEX_SETTINGS, embedding });
      const paths = staged.filter((s) => s.path).map((s) => s.path as string);
      const blobs: { name: string; data: Uint8Array }[] = [];
      for (const s of staged) {
        if (!s.path && s.file) blobs.push({ name: s.name, data: new Uint8Array(await s.file.arrayBuffer()) });
      }
      const results: KnowledgeAddResult[] = [];
      if (paths.length) results.push(await api.addPaths(made.id, paths));
      if (blobs.length) results.push(await api.addFiles(made.id, blobs));
      const added = results.reduce((n, r) => n + r.added.length, 0);
      const skipped = results.reduce((n, r) => n + r.skipped, 0);
      const parts = [added ? t('knowledge.add.done', { count: added }) : '', skipped ? t('knowledge.add.skipped', { count: skipped }) : ''].filter(Boolean);
      onDone(made, parts.join(' ') || t('knowledge.add.nothing'));
    } catch (err) {
      if (cancelledRef.current && kb) onDone(kb, t('knowledge.progress.cancelled'));
      else if (kb) onError(t('knowledge.add.failed'), err);
      else onError(t('knowledge.create.failed'), err);
    } finally {
      onEnd();
    }
  };

  // 자료는 나중에 상세 화면에서 넣을 수 있어 이름만으로도 만든다
  const canSubmit = !busy && !!cleanKnowledgeName(name);
  const totalBytes = staged.reduce((n, s) => n + s.size, 0);

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-document-form="">
      <div
        data-knowledge-create-drop=""
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = busy ? 'none' : 'copy';
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={onDrop}
        className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed border-line p-5 text-center transition-colors', dragOver && 'border-accent bg-accent-soft')}
      >
        <Upload size={20} className="text-fg-2" />
        <p className="text-[13px] text-fg-2">{t('knowledge.add.drop')}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t('knowledge.create.document.pick')}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => folderInput.current?.click()}>
            {t('knowledge.create.document.pickFolder')}
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          aria-label={t('knowledge.create.document.pick')}
          onChange={(e) => {
            if (e.target.files) fromFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          aria-label={t('knowledge.create.document.pickFolder')}
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            if (e.target.files) fromFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {notice && (
        <p role="status" className="text-[13px] text-fg-2">
          {notice}
        </p>
      )}

      {staged.length === 0 ? (
        <p className="text-[13px] text-fg-2">{t('knowledge.create.document.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-fg-2">{t('knowledge.create.document.count', { count: staged.length, size: formatSize(totalBytes) })}</p>
          <ul aria-label={t('knowledge.create.document.listLabel')} className="scroll-thin flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-lg border border-line p-1">
            {staged.map((s) => (
              <li key={s.key} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-2">
                <FileText size={14} className="shrink-0 text-fg-2" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-fg-2">{s.size > 0 ? formatSize(s.size) : ''}</span>
                <IconButton size="sm" label={`${t('knowledge.create.document.remove')}: ${s.name}`} disabled={busy} onClick={() => setStaged((prev) => prev.filter((x) => x.key !== s.key))} className="size-6">
                  <X size={13} />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.name')}</span>
        <input
          aria-label={t('knowledge.create.title')}
          value={name}
          maxLength={80}
          placeholder={t('knowledge.create.namePlaceholder')}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          className="h-9 rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">{t('knowledge.create.description')}</span>
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          disabled={busy}
          onChange={(e) => setDescription(e.target.value)}
          className="scroll-thin resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-[13px] font-medium text-fg-2">{t('knowledge.create.document.index.label')}</legend>
        <IndexRadio name="index" value="local-hash" current={provider} disabled={busy} onPick={setProvider} label={t('knowledge.create.document.index.local')} />
        <IndexRadio name="index" value="none" current={provider} disabled={busy} onPick={setProvider} label={t('knowledge.create.document.index.none')} />
        <details open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)} className="text-[13px] text-fg-2">
          <summary className="cursor-pointer select-none">{t('knowledge.create.document.index.advanced')}</summary>
          <div className="mt-2 flex flex-col gap-2 pl-1">
            <IndexRadio name="index" value="openai" current={provider} disabled={busy} onPick={setProvider} label={t('knowledge.create.document.index.openai')} />
            {provider === 'openai' && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] text-warn">{t('knowledge.embedding.openaiNotice')}</p>}
          </div>
        </details>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {t('knowledge.create.document.submit')}
        </Button>
      </div>
    </form>
  );
}

function IndexRadio({
  name,
  value,
  current,
  disabled,
  onPick,
  label,
}: {
  name: string;
  value: EmbeddingProvider;
  current: EmbeddingProvider;
  disabled: boolean;
  onPick(v: EmbeddingProvider): void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13.5px] text-fg">
      <input type="radio" name={name} value={value} checked={current === value} disabled={disabled} onChange={() => onPick(value)} className="accent-accent" />
      <span>{label}</span>
    </label>
  );
}
