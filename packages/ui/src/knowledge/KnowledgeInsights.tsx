import { t } from '../i18n';
import { DEFAULT_RAG_SETTINGS, type KnowledgeDoc, type KnowledgeIndexSettings, type KnowledgeIndexState, type KnowledgeSource, type RagSettings } from '@branch/core';
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { ipcErrorMessage, knowledgeApi } from './api';

/**
 * 지식베이스 상세의 부가 패널 (ADR-113): 설명, 문서 목록·검색, 출처, 임베딩 설정, 검색 설정, 저장 용량.
 * 모두 DesktopKnowledgeApi의 optional 메서드를 쓰고, 없으면 해당 패널을 그리지 않는다.
 */

/** 실패 문구: 기본 문구 뒤에 IPC가 준 원인을 덧붙인다 */
function failure(e: unknown): string {
  const detail = ipcErrorMessage(e);
  return detail ? `${t('knowledge.error.generic')} (${detail})` : t('knowledge.error.generic');
}

/** 바이트 → 사람이 읽는 단위 */
export function bytesLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-[13px] font-semibold text-fg-2">{title}</h4>
      {children}
    </section>
  );
}

/** 설명: 질문 문맥을 잡는 데 쓰인다. 빈 값이면 지운다 */
export function DescriptionEditor({ kbId, description, onSaved }: { kbId: string; description?: string; onSaved(): void }) {
  const api = knowledgeApi();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!api?.setDescription) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next = draft.trim();
    if (next.length > 500) {
      setError(t('knowledge.error.badDescription'));
      return;
    }
    setBusy(true);
    try {
      await api.setDescription!(kbId, next);
      setEditing(false);
      setError(null);
      onSaved();
    } catch (err) {
      setError(failure(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <p data-knowledge-description className="min-w-0 flex-1 text-[13px] text-fg-2">
          {description?.trim() || t('knowledge.description.empty')}
        </p>
        <Button size="sm" variant="ghost" onClick={() => { setDraft(description ?? ''); setEditing(true); }}>
          {t('knowledge.description.edit')}
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-[12px] text-fg-2">
        {t('knowledge.description.label')}
        <textarea
          autoFocus
          value={draft}
          maxLength={500}
          rows={2}
          placeholder={t('knowledge.description.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          className="scroll-thin resize-none rounded-lg border border-line bg-surface px-2 py-1.5 text-[13px] text-fg outline-none focus:border-accent"
        />
      </label>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          {t('knowledge.description.cancel')}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={busy}>
          {t('knowledge.description.save')}
        </Button>
      </div>
    </form>
  );
}

/** 문서 목록과 검색 (경로·제목 부분 일치). 색인이 끝나면 다시 읽는다 */
/** revision: 자료가 바뀔 때마다 바뀌는 값 (상위의 트리). 바뀌면 목록을 다시 읽는다 */
export function DocsPanel({ kbId, revision }: { kbId: string; revision: unknown }) {
  const api = knowledgeApi();
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.docs) return;
    let alive = true;
    const handle = setTimeout(() => {
      api
        .docs!(kbId, query.trim() || undefined)
        .then((list) => alive && (setDocs(list), setError(null)))
        .catch((e: unknown) => alive && setError(failure(e)));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [api, kbId, query, revision]);

  useEffect(() => {
    if (!api?.onIndexState || !api.docs) return;
    return api.onIndexState((s: KnowledgeIndexState) => {
      if (s.kbId !== kbId || s.status !== 'ready') return;
      void api.docs!(kbId, query.trim() || undefined).then(setDocs).catch(() => undefined);
    });
  }, [api, kbId, query]);

  if (!api?.docs) return null;
  return (
    <Section title={t('knowledge.docs.heading')}>
      <input
        type="search"
        aria-label={t('knowledge.docs.search')}
        placeholder={t('knowledge.docs.search')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] outline-none focus:border-accent"
      />
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {docs === null ? null : docs.length === 0 ? (
        <p className="text-[13px] text-fg-2">{query.trim() ? t('knowledge.docs.noMatch') : t('knowledge.docs.empty')}</p>
      ) : (
        <ul aria-label={t('knowledge.docs.heading')} className="flex flex-col gap-1">
          {docs.map((d) => (
            <li key={d.docId} data-doc={d.path} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[12px]">
              <span className="min-w-0 flex-1 truncate" title={d.path}>
                {d.title || d.path}
              </span>
              <span className="shrink-0 text-muted">{t('knowledge.docs.chunks', { count: d.chunkCount })}</span>
              {d.status !== 'ok' && (
                <span className={cn('shrink-0', d.status === 'error' ? 'text-danger' : 'text-muted')} title={d.error}>
                  {d.status === 'error' ? t('knowledge.docs.failed') : t('knowledge.docs.skipped')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 출처 종류 표시 문구 (키는 명시적으로 나열한다) */
function sourceTypeLabel(type: KnowledgeSource['type']): string {
  switch (type) {
    case 'files':
      return t('knowledge.sources.type.files');
    case 'folder':
      return t('knowledge.sources.type.folder');
    case 'github':
      return t('knowledge.sources.type.github');
    case 'web':
      return t('knowledge.sources.type.web');
  }
}

/** 출처 목록. 갱신 버튼은 링크를 다시 받거나 저장소를 다시 클론한다 */
export function SourcesPanel({ kbId, revision, onChanged }: { kbId: string; revision: unknown; onChanged(): void }) {
  const api = knowledgeApi();
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [updating, setUpdating] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);

  const load = () => {
    if (!api?.sources) return;
    void api.sources(kbId).then(setSources).catch(() => undefined);
  };
  useEffect(load, [api, kbId, revision]);

  if (!api?.sources) return null;
  const update = async (s: KnowledgeSource) => {
    if (!api.updateSource) return;
    setUpdating(s.id);
    setNotice(null);
    try {
      await api.updateSource(kbId, s.id);
      setNotice({ text: t('knowledge.sources.updated', { name: s.location }), tone: 'info' });
      load();
      onChanged();
    } catch (e) {
      setNotice({ text: failure(e), tone: 'error' });
    } finally {
      setUpdating(null);
    }
  };
  return (
    <Section title={t('knowledge.sources.heading')}>
      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('text-[12px]', notice.tone === 'error' ? 'text-danger' : 'text-fg-2')}>
          {notice.text}
        </p>
      )}
      {sources.length === 0 ? (
        <p className="text-[13px] text-fg-2">{t('knowledge.sources.empty')}</p>
      ) : (
        <ul aria-label={t('knowledge.sources.heading')} className="flex flex-col gap-1">
          {sources.map((s) => (
            <li key={s.id} data-source={s.id} className="flex items-center gap-2 text-[12px]">
              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-muted">{sourceTypeLabel(s.type)}</span>
              <span className="min-w-0 flex-1 truncate" title={s.location}>
                {s.location}
              </span>
              {s.type !== 'files' && s.type !== 'folder' && (
                <Button size="sm" variant="ghost" disabled={updating !== null} onClick={() => void update(s)}>
                  {updating === s.id ? t('knowledge.sources.updating') : t('knowledge.sources.update')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** 임베딩 모델. OpenAI는 문서 본문이 외부 서버로 전송되므로 먼저 알린다 */
export function EmbeddingPanel({ kbId }: { kbId: string }) {
  const api = knowledgeApi();
  const [settings, setSettings] = useState<KnowledgeIndexSettings | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!api?.getIndexSettings) return;
    void api.getIndexSettings(kbId).then(setSettings).catch(() => undefined);
  }, [api, kbId]);

  if (!api?.getIndexSettings || !settings) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!api.setIndexSettings) return;
    setBusy(true);
    try {
      const state = await api.setIndexSettings(kbId, settings);
      setNotice({ text: state.status === 'stale' || state.status === 'queued' ? t('knowledge.embedding.reindexNeeded') : t('knowledge.embedding.saved'), tone: 'info' });
    } catch (err) {
      setNotice({ text: failure(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const provider = settings.embedding.provider;
  return (
    <Section title={t('knowledge.embedding.heading')}>
      <form onSubmit={save} className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-2">{t('knowledge.embedding.provider')}</span>
          <select
            value={provider}
            onChange={(e) => setSettings({ embedding: { provider: e.target.value as 'local-hash' | 'openai', model: undefined } })}
            className="h-8 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
          >
            <option value="local-hash">{t('knowledge.embedding.local')}</option>
            <option value="openai">{t('knowledge.embedding.openai')}</option>
          </select>
        </label>
        {provider === 'openai' && (
          <p role="note" data-external-notice="" className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
            {t('knowledge.embedding.openaiNotice')}
          </p>
        )}
        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-2">{t('knowledge.embedding.model')}</span>
          <input
            value={settings.embedding.model ?? ''}
            placeholder={provider === 'openai' ? 'text-embedding-3-small' : t('knowledge.embedding.modelDefault')}
            onChange={(e) => setSettings({ embedding: { provider, model: e.target.value.trim() || undefined } })}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
          />
        </label>
        {notice && (
          <p role={notice.tone === 'error' ? 'alert' : 'status'} className={cn('text-[12px]', notice.tone === 'error' ? 'text-danger' : 'text-fg-2')}>
            {notice.text}
          </p>
        )}
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" type="submit" disabled={busy || !api.setIndexSettings}>
            {t('knowledge.embedding.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** 검색 설정. 값은 호출하는 쪽이 보관한다 (Settings.rag, 스토어 연결 후) */
export function RagSettingsPanel({ value, onSave }: { value: RagSettings; onSave(next: RagSettings): void }) {
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof RagSettings>(k: K, v: RagSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (e: ChangeEvent<HTMLInputElement>, min: number, max: number) => Math.min(max, Math.max(min, Number(e.target.value) || min));
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };
  return (
    <Section title={t('knowledge.rag.heading')}>
      <form onSubmit={submit} className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {t('knowledge.rag.enabled')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.rerank} onChange={(e) => set('rerank', e.target.checked)} />
          {t('knowledge.rag.rerank')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.expandParent} onChange={(e) => set('expandParent', e.target.checked)} />
          {t('knowledge.rag.expandParent')}
        </label>
        <label className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-fg-2">{t('knowledge.rag.topK')}</span>
          <input type="number" min={1} max={12} value={draft.topK} onChange={(e) => set('topK', num(e, 1, 12))} className="h-8 w-20 rounded-lg border border-line bg-surface px-2" />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-fg-2">{t('knowledge.rag.minScore')}</span>
          <input type="number" min={0} max={1} step={0.05} value={draft.minScore} onChange={(e) => set('minScore', num(e, 0, 1))} className="h-8 w-20 rounded-lg border border-line bg-surface px-2" />
        </label>
        <label className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-fg-2">{t('knowledge.rag.maxContextChars')}</span>
          <input
            type="number"
            min={2000}
            max={20000}
            step={500}
            value={draft.maxContextChars}
            onChange={(e) => set('maxContextChars', num(e, 2000, 20000))}
            className="h-8 w-24 rounded-lg border border-line bg-surface px-2"
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDraft(DEFAULT_RAG_SETTINGS)}>
            {t('knowledge.rag.reset')}
          </Button>
          <Button size="sm" variant="secondary" type="submit" disabled={!dirty}>
            {t('knowledge.rag.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** 저장 용량: 원본 크기와 색인 크기, 문서·청크 수 */
export function StoragePanel({ kbId }: { kbId: string }) {
  const api = knowledgeApi();
  const [state, setState] = useState<KnowledgeIndexState | null>(null);
  useEffect(() => {
    if (!api?.indexStates) return;
    let alive = true;
    void api.indexStates([kbId]).then((list) => alive && setState(list[0] ?? null)).catch(() => undefined);
    const off = api.onIndexState?.((s) => s.kbId === kbId && setState(s));
    return () => {
      alive = false;
      off?.();
    };
  }, [api, kbId]);
  if (!api?.indexStates || !state) return null;
  return (
    <Section title={t('knowledge.storage.heading')}>
      <dl data-storage-usage="" className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-4">
        <div>
          <dt className="text-muted">{t('knowledge.storage.source')}</dt>
          <dd>{bytesLabel(state.sourceBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('knowledge.storage.index')}</dt>
          <dd>{bytesLabel(state.indexBytes)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('knowledge.storage.docs')}</dt>
          <dd>{state.docCount}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('knowledge.storage.chunks')}</dt>
          <dd>{state.chunkCount}</dd>
        </div>
      </dl>
    </Section>
  );
}

/** 상세 부가 패널 묶음. 설명은 호출하는 쪽이 저장 후 다시 읽는다 */
export function KnowledgeInsights({ kbId, description, revision, onChanged }: { kbId: string; description?: string; revision: unknown; onChanged(): void }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-3">
      {knowledgeApi()?.setDescription && <DescriptionEditor kbId={kbId} description={description} onSaved={onChanged} />}
      <StoragePanel kbId={kbId} />
      <EmbeddingPanel kbId={kbId} />
      <DocsPanel kbId={kbId} revision={revision} />
      <SourcesPanel kbId={kbId} revision={revision} onChanged={onChanged} />
    </div>
  );
}
