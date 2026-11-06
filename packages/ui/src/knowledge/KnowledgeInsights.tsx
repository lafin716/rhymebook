import { t } from '../i18n';
import {
  DEFAULT_OPENAI_EMBEDDING_MODEL,
  DEFAULT_RAG_SETTINGS,
  OPENAI_EMBEDDING_MODELS,
  RAG_MODES,
  type EmbeddingProviderId,
  type KnowledgeIndexSettings,
  type KnowledgeIndexState,
  type KnowledgeSource,
  type RagMode,
  type RagSettings,
} from '@branch/core';
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { Toggle } from '../settings/controls';
import { cn } from '../lib/cn';
import { ipcErrorMessage, knowledgeApi } from './api';

/**
 * 지식베이스 상세의 부가 패널 (ADR-113): 설명, 출처, 임베딩 설정, 검색 설정, 저장 용량.
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

function Section({ title, children, bare }: { title: string; children: ReactNode; bare?: boolean }) {
  if (bare) return <>{children}</>;
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
          rows={3}
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
export function EmbeddingPanel({ kbId, bare }: { kbId: string; bare?: boolean }) {
  const api = knowledgeApi();
  const [settings, setSettings] = useState<KnowledgeIndexSettings | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sourceBytes, setSourceBytes] = useState(0);

  useEffect(() => {
    if (!api?.getIndexSettings) return;
    void api.getIndexSettings(kbId).then(setSettings).catch(() => undefined);
    void api.indexStates?.([kbId]).then((l) => setSourceBytes(l[0]?.sourceBytes ?? 0)).catch(() => undefined);
  }, [api, kbId]);

  if (!api?.getIndexSettings || !settings) return null;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!api.setIndexSettings) return;
    setBusy(true);
    try {
      // 자동 색인 등 다른 설정은 최신 값을 유지한다
      const latest = await api.getIndexSettings!(kbId).catch(() => settings);
      const state = await api.setIndexSettings(kbId, { ...latest, embedding: settings.embedding });
      setNotice({ text: state.status === 'stale' || state.status === 'queued' ? t('knowledge.embedding.reindexNeeded') : t('knowledge.embedding.saved'), tone: 'info' });
    } catch (err) {
      setNotice({ text: failure(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const provider = settings.embedding.provider;
  const emb = settings.embedding;
  const openaiModel = emb.model && OPENAI_EMBEDDING_MODELS[emb.model] ? emb.model : DEFAULT_OPENAI_EMBEDDING_MODEL;
  // 비용 추정: 원본 글자 수 ≈ 바이트, 토큰 ≈ 바이트/4 (한국어는 더 많을 수 있어 상한 표시용)
  const tokens = sourceBytes > 0 ? Math.ceil(sourceBytes / 4) : 0;
  const usd = (tokens / 1_000_000) * (OPENAI_EMBEDDING_MODELS[openaiModel]?.usdPer1MTokens ?? 0);
  return (
    <Section title={t('knowledge.embedding.heading')} bare={bare}>
      <form onSubmit={save} className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <span className="w-24 shrink-0 text-fg-2">{t('knowledge.embedding.provider')}</span>
          <select
            value={provider}
            onChange={(e) => setSettings({ ...settings, embedding: { provider: e.target.value as EmbeddingProviderId } })}
            className="h-8 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
          >
            <option value="none">{t('knowledge.embedding.none')}</option>
            <option value="local-hash">{t('knowledge.embedding.local')}</option>
            <option value="openai">{t('knowledge.embedding.openai')}</option>
          </select>
        </label>
        <p className="text-[12px] text-muted">{t(`knowledge.embedding.hint.${provider}`)}</p>
        {provider === 'openai' && (
          <>
            <p role="note" data-external-notice="" className="rounded-lg bg-warn-soft px-3 py-2 text-[12px] text-warn">
              {t('knowledge.embedding.openaiNotice')}
            </p>
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-fg-2">{t('knowledge.embedding.model')}</span>
              <select
                value={openaiModel}
                onChange={(e) => setSettings({ ...settings, embedding: { provider, model: e.target.value } })}
                className="h-8 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
              >
                {Object.keys(OPENAI_EMBEDDING_MODELS).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-24 shrink-0 text-fg-2">{t('knowledge.embedding.dimensions')}</span>
              <input
                type="number"
                min={64}
                max={OPENAI_EMBEDDING_MODELS[openaiModel]?.dim ?? 3072}
                step={64}
                value={emb.dimensions ?? ''}
                placeholder={String(OPENAI_EMBEDDING_MODELS[openaiModel]?.dim ?? '')}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const max = OPENAI_EMBEDDING_MODELS[openaiModel]?.dim ?? 3072;
                  setSettings({ ...settings, embedding: { provider, model: openaiModel, ...(e.target.value && Number.isInteger(n) && n >= 64 && n <= max ? { dimensions: n } : {}) } });
                }}
                className="h-8 w-28 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
              />
            </label>
            {tokens > 0 && (
              <p data-cost-estimate="" className="text-[12px] text-fg-2">
                {t('knowledge.embedding.costEstimate', { tokens: tokens.toLocaleString(), usd: usd < 0.01 ? '<0.01' : usd.toFixed(2) })}
              </p>
            )}
          </>
        )}
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
export function RagSettingsPanel({ value, onSave, bare }: { value: RagSettings; onSave(next: RagSettings): void; bare?: boolean }) {
  const [draft, setDraft] = useState(value);
  const set = <K extends keyof RagSettings>(k: K, v: RagSettings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const num = (e: ChangeEvent<HTMLInputElement>, min: number, max: number) => Math.min(max, Math.max(min, Number(e.target.value) || min));
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft);
  };
  const form = (
      <form onSubmit={submit} className="flex flex-col gap-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
          {t('knowledge.rag.enabled')}
        </label>
        <label className="flex items-center gap-2">
          <span className="w-40 shrink-0 text-fg-2">{t('knowledge.rag.mode')}</span>
          <select
            data-rag-mode=""
            value={draft.mode ?? 'auto'}
            onChange={(e) => set('mode', e.target.value as RagMode)}
            className="h-8 rounded-lg border border-line bg-surface px-2 outline-none focus:border-accent"
          >
            {RAG_MODES.map((m) => (
              <option key={m} value={m}>
                {t(`knowledge.mode.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-muted">{t(`knowledge.mode.hint.${draft.mode ?? 'auto'}`)}</p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.rerank} onChange={(e) => set('rerank', e.target.checked)} />
          {t('knowledge.rag.rerank')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.expandParent} onChange={(e) => set('expandParent', e.target.checked)} />
          {t('knowledge.rag.expandParent')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.expandQuery} onChange={(e) => set('expandQuery', e.target.checked)} />
          {t('knowledge.rag.expandQuery')}
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={draft.debug === true} onChange={(e) => set('debug', e.target.checked)} />
          {t('knowledge.rag.debug')}
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
  );
  return bare ? form : <Section title={t('knowledge.rag.heading')}>{form}</Section>;
}

/** 저장 용량: 원본 크기와 색인 크기, 문서·청크 수 */
export function StoragePanel({ kbId, bare }: { kbId: string; bare?: boolean }) {
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
    <Section title={t('knowledge.storage.heading')} bare={bare}>
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

/** 상세에 남는 패널: 출처 (설명·용량·임베딩은 설정 팝업으로). 색인된 문서 목록은 보여 주지 않는다 (ADR-119) */
export function KnowledgeInsights({ kbId, revision, onChanged }: { kbId: string; revision: unknown; onChanged(): void }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line p-3">
      <SourcesPanel kbId={kbId} revision={revision} onChanged={onChanged} />
    </div>
  );
}

/** 팝업 머리글과 닫기 버튼 */
function PopupFrame({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="flex-1 truncate text-[16px] font-semibold">{title}</h2>
        <IconButton size="sm" label={t('knowledge.settings.close')} onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{children}</div>
    </>
  );
}

/** 팝업 안의 한 구역: 제목, 짧은 안내, 내용 */
function Block({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-5 py-4">
      <div>
        <h3 className="text-[14px] font-semibold text-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** 검색 설정 팝업 (전역 Settings.rag). 저장하면 닫는다 */
export function RagSettingsDialog({ open, onClose, value, onSave }: { open: boolean; onClose(): void; value: RagSettings; onSave(next: RagSettings): void }) {
  return (
    <Modal open={open} onClose={onClose} label={t('knowledge.rag.heading')} className="md:max-w-md">
      <PopupFrame title={t('knowledge.rag.heading')} onClose={onClose}>
        <Block title={t('knowledge.rag.heading')} hint={t('knowledge.rag.hint')}>
          <RagSettingsPanel
            bare
            value={value}
            onSave={(next) => {
              onSave(next);
              onClose();
            }}
          />
        </Block>
      </PopupFrame>
    </Modal>
  );
}

/** 지식베이스 설정 팝업: 설명, 저장 용량, 임베딩 모델 */
export function KnowledgeSettingsDialog({
  open,
  onClose,
  kbId,
  name,
  description,
  onChanged,
}: {
  open: boolean;
  onClose(): void;
  kbId: string;
  name: string;
  description?: string;
  onChanged(): void;
}) {
  const api = knowledgeApi();
  return (
    <Modal open={open} onClose={onClose} label={t('knowledge.settings.title')} className="md:max-w-lg">
      <PopupFrame title={t('knowledge.settings.titleOf', { name })} onClose={onClose}>
        <div data-knowledge-settings="" className="flex flex-col divide-y divide-line">
          {api?.setDescription && (
            <Block title={t('knowledge.description.label')} hint={t('knowledge.settings.descriptionHint')}>
              <DescriptionEditor kbId={kbId} description={description} onSaved={onChanged} />
            </Block>
          )}
          <Block title={t('knowledge.storage.heading')}>
            <StoragePanel kbId={kbId} bare />
          </Block>
          <Block title={t('knowledge.embedding.heading')} hint={t('knowledge.settings.embeddingHint')}>
            <EmbeddingPanel kbId={kbId} bare />
          </Block>
        </div>
      </PopupFrame>
    </Modal>
  );
}

/** 자동 색인 스위치: 끄면 파일을 넣어도 색인하지 않는다 (다시 색인으로 직접 실행) */
export function AutoIndexSwitch({ kbId }: { kbId: string }) {
  const api = knowledgeApi();
  const [on, setOn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOn(null);
    if (!api?.getIndexSettings) return;
    let alive = true;
    void api
      .getIndexSettings(kbId)
      .then((s) => alive && setOn(s.autoIndex !== false))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, kbId]);
  if (!api?.getIndexSettings || !api.setIndexSettings || on === null) return null;
  const change = async (next: boolean) => {
    setOn(next);
    setError(null);
    try {
      const cur = await api.getIndexSettings!(kbId);
      await api.setIndexSettings!(kbId, { ...cur, autoIndex: next });
    } catch (err) {
      setOn(!next);
      setError(failure(err));
    }
  };
  return (
    <div className="flex items-center gap-2" data-auto-index={on ? 'on' : 'off'} title={error ?? t('knowledge.autoIndex.hint')}>
      <span className={cn('text-[12.5px]', error ? 'text-danger' : 'text-fg-2')}>{t('knowledge.autoIndex.label')}</span>
      <Toggle checked={on} onChange={(v) => void change(v)} label={t('knowledge.autoIndex.label')} />
    </div>
  );
}
