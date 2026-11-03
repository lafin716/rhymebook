import { CloudUpload, Download, FileJson, FolderGit2, HardDrive, History, Lock, TriangleAlert, Upload } from 'lucide-react';
import { BACKUP_TARGET_LABEL, GITHUB_REPO_RE, type AutoBackupMode, type BackupEntry, type BackupTargetId, type RestoreMode } from '@branch/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  backupNow,
  connectDrive,
  connectGithub,
  disconnectDrive,
  disconnectGithub,
  exportFile,
  importFile,
  refreshList,
  restore,
  setPassphrase,
  setPrefs,
  useBackup,
} from '../backup/service';
import { Badge, StatusDot } from '../components/Badge';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/time';
import { intlLocale, t } from '../i18n';
import { Field, Section, Segmented, Toggle } from './controls';

/** 설정 › 백업 탭. 상태와 동작은 backup/service (ADR-015) */
/** 대상마다 파일 이름이 같을 수 있어 대상 id를 붙인다 */
const entryKey = (e: BackupEntry) => `${e.targetId}|${e.id}`;
// 단위 기호(B, KB)는 어느 언어에서나 같아 번역하지 않는다
const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function BackupTab() {
  const s = useBackup(
    useShallow((b) => ({
      gdrive: b.gdrive,
      github: b.github,
      githubRepo: b.githubRepo,
      auto: b.auto,
      keep: b.keep,
      encrypt: b.encrypt,
      passphrase: b.passphrase,
      busy: b.busy,
      entries: b.entries,
      error: b.error,
      notice: b.notice,
    })),
  );
  const { gdrive, github, auto, keep, encrypt, entries } = s;
  const busy = s.busy === 'backup';
  const [restoring, setRestoring] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const primary: BackupTargetId = gdrive ? 'gdrive' : github ? 'github' : 'file';
  // 같은 시점의 사본이 여러 곳에 있으면 자동 백업 대상 것을 보여 준다
  const last = entries.find((e) => e.at === entries[0]?.at && e.targetId === primary) ?? entries[0];

  useEffect(() => {
    void refreshList().catch(() => undefined);
  }, []);

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const entry = await importFile(file);
    if (entry) {
      setSelected(entryKey(entry));
      setRestoring(true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
            <CloudUpload size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[14.5px] font-medium">
              {last ? t('settings.backup.lastAt', { time: relativeTime(last.at) }) : t('settings.backup.noneYet')}
            </div>
            <div className="text-[12.5px] text-muted">
              {last ? `${BACKUP_TARGET_LABEL[last.targetId]} · ${formatSize(last.size)}` : t('settings.backup.what')}
            </div>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" icon={<History size={14} />} onClick={() => setRestoring((r) => !r)} aria-expanded={restoring}>
              {t('settings.backup.restore')}
            </Button>
            <Button size="sm" variant="primary" className="flex-1 sm:flex-none" icon={<Upload size={14} className={busy ? 'animate-pulse' : ''} />} onClick={() => void backupNow()} disabled={!!s.busy}>
              {busy ? t('settings.backup.backingUp') : t('settings.backup.backupNow')}
            </Button>
          </div>
        </div>
        {(s.error || s.notice) && (
          <p role="status" className={cn('mt-2 flex items-start gap-1.5 text-[12.5px]', s.error ? 'text-danger' : 'text-ok')}>
            {s.error && <TriangleAlert size={13} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 break-words">{s.error ?? s.notice}</span>
          </p>
        )}
        {restoring && (
          <RestorePanel
            key={selected ?? 'latest'}
            versions={entries}
            initial={selected}
            passphrase={s.passphrase}
            busy={s.busy === 'restore'}
            onRestore={async (entry, mode, pass) => {
              if (await restore(entry, mode, pass)) {
                setRestoring(false);
                setSelected(null);
              }
            }}
            onClose={() => {
              setRestoring(false);
              setSelected(null);
            }}
          />
        )}
      </div>

      <Section title={t('settings.backup.locationTitle')} hint={t('settings.backup.locationHint')}>
        <TargetCard icon={<HardDrive size={18} />} title={t('settings.backup.fileTitle')} status={t('settings.backup.fileStatus')} tone="ok">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Download size={14} />} onClick={() => void exportFile()}>
              {t('settings.backup.exportJson')}
            </Button>
            <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => fileInput.current?.click()}>
              {t('settings.backup.importFile')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label={t('settings.backup.importAria')}
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </TargetCard>

        <TargetCard
          icon={<GoogleDriveIcon />}
          title={t('settings.backup.driveTitle')}
          status={gdrive ? t('settings.backup.driveStatus', { account: gdrive }) : t('settings.backup.notConnected')}
          tone={gdrive ? 'ok' : 'neutral'}
          badge={primary === 'gdrive' ? t('settings.backup.autoTarget') : undefined}
        >
          {gdrive ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
              <span>{t('settings.backup.driveNote')}</span>
              <Button size="sm" variant="ghost" onClick={() => void disconnectDrive()}>
                {t('settings.backup.disconnect')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="soft" onClick={() => void connectDrive()} disabled={!!s.busy}>
              {t('settings.backup.driveConnect')}
            </Button>
          )}
        </TargetCard>

        <TargetCard
          icon={<FolderGit2 size={18} />}
          title={t('settings.backup.githubTitle')}
          status={github ? t('settings.backup.githubStatus', { repo: github }) : t('settings.backup.notConnected')}
          tone={github ? 'ok' : 'neutral'}
          badge={primary === 'github' ? t('settings.backup.autoTarget') : undefined}
        >
          {github ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
              <span>{t('settings.backup.githubNote')}</span>
              <Button size="sm" variant="ghost" onClick={() => void disconnectGithub()}>
                {t('settings.backup.disconnect')}
              </Button>
            </div>
          ) : (
            <GithubForm initialRepo={s.githubRepo ?? ''} busy={s.busy === 'connect'} onConnect={connectGithub} />
          )}
        </TargetCard>
      </Section>

      <Field label={t('settings.backup.autoLabel')} hint={t('settings.backup.autoHint')}>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<AutoBackupMode>
            value={auto}
            options={[
              ['off', t('settings.backup.autoOff')],
              ['change', t('settings.backup.autoChange')],
              ['daily', t('settings.backup.autoDaily')],
            ]}
            onChange={(v) => setPrefs({ auto: v })}
          />
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            {t('settings.backup.recent')}
            <select
              value={keep}
              onChange={(e) => setPrefs({ keep: Number(e.target.value) })}
              className="h-8 rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent"
            >
              {[5, 10, 30].map((n) => (
                <option key={n} value={n}>
                  {t('settings.backup.keepCount', { n })}
                </option>
              ))}
            </select>
            {t('settings.backup.keep')}
          </label>
        </div>
      </Field>

      <div>
        <div className="flex items-center gap-3">
          <Lock size={16} className="shrink-0 text-fg-2" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">{t('settings.backup.encryptLabel')}</div>
            <p className="text-[12.5px] text-muted">{t('settings.backup.encryptHint')}</p>
          </div>
          <Toggle checked={encrypt} onChange={(v) => setPrefs({ encrypt: v })} label={t('settings.backup.encryptAria')} />
        </div>
        {encrypt && (
          <div className="mt-2 space-y-2 pl-7">
            <input
              type="password"
              value={s.passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={t('settings.backup.passAria')}
              aria-label={t('settings.backup.passAria')}
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent"
            />
            <p className="flex items-start gap-1.5 text-[12px] text-warn">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              {t('settings.backup.passWarn')}
            </p>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[12px] text-muted">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
        {t('settings.backup.secretsNote')}
      </p>
    </div>
  );
}

function TargetCard({
  icon,
  title,
  status,
  tone,
  badge,
  children,
}: {
  icon: ReactNode;
  title: string;
  status: string;
  tone: 'ok' | 'neutral';
  badge?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-fg-2">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[14.5px] font-medium">{title}</span>
            {badge && <Badge tone="accent">{badge}</Badge>}
          </div>
          <div className="flex items-center gap-1.5 text-[12.5px] text-muted">
            <StatusDot tone={tone} />
            <span className="min-w-0 truncate">{status}</span>
          </div>
        </div>
      </div>
      <div className="mt-3 border-t border-line pt-3">{children}</div>
    </div>
  );
}

function GithubForm({ initialRepo, busy, onConnect }: { initialRepo: string; busy: boolean; onConnect(repo: string, token: string): Promise<void> }) {
  const [repo, setRepo] = useState(initialRepo);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ok = GITHUB_REPO_RE.test(repo.trim()) && token.trim().length > 0 && !busy;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        setError(null);
        onConnect(repo.trim(), token.trim()).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder={t('settings.backup.repoPlaceholder')}
          aria-label={t('settings.backup.repoAria')}
          className="h-9 min-w-0 shrink-0 rounded-lg border border-line bg-bg px-3 text-[13px] sm:flex-1 outline-none focus:border-accent"
        />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          aria-label={t('settings.backup.tokenAria')}
          autoComplete="off"
          className="h-9 min-w-0 shrink-0 rounded-lg border border-line bg-bg px-3 font-mono sm:flex-1 text-[13px] outline-none placeholder:font-sans focus:border-accent"
        />
        <Button size="sm" variant="primary" type="submit" disabled={!ok} className="h-9">
          {busy ? t('settings.backup.checking') : t('settings.backup.connect')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <p className="text-[12px] text-muted">{t('settings.backup.tokenHint')}</p>
    </form>
  );
}

function RestorePanel({
  versions,
  initial,
  passphrase,
  busy,
  onRestore,
  onClose,
}: {
  versions: BackupEntry[];
  initial: string | null;
  passphrase: string;
  busy: boolean;
  onRestore(entry: BackupEntry, mode: RestoreMode, passphrase?: string): Promise<void>;
  onClose(): void;
}) {
  const [sel, setSel] = useState(initial ?? (versions[0] ? entryKey(versions[0]) : null));
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [pass, setPass] = useState(passphrase);
  const entry = versions.find((v) => entryKey(v) === sel) ?? null;
  if (versions.length === 0) {
    return (
      <div className="mt-3 border-t border-line pt-3 text-[12.5px] text-muted">
        {t('settings.backup.noBackups')}
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line" role="radiogroup" aria-label={t('settings.backup.listAria')}>
        {versions.map((v) => (
          <li key={entryKey(v)}>
            <button
              type="button"
              role="radio"
              aria-checked={sel === entryKey(v)}
              onClick={() => setSel(entryKey(v))}
              className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-[13px]', sel === entryKey(v) && 'bg-accent-soft')}
            >
              <span className={cn('size-3.5 shrink-0 rounded-full border-2', sel === entryKey(v) ? 'border-accent bg-accent' : 'border-line-strong')} />
              <span className="flex-1">
                {new Date(v.at).toLocaleString(intlLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              {v.encrypted && <Lock size={12} className="text-muted" />}
              <span className="text-[12px] text-muted">
                {BACKUP_TARGET_LABEL[v.targetId]} · {formatSize(v.size)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {entry?.encrypted && (
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder={t('settings.backup.entryPassPlaceholder')}
          aria-label={t('settings.backup.entryPassAria')}
          autoComplete="current-password"
          className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent"
        />
      )}
      <Segmented<RestoreMode>
        value={mode}
        options={[
          ['merge', t('settings.backup.modeMerge')],
          ['replace', t('settings.backup.modeReplace')],
        ]}
        onChange={setMode}
      />
      <p className="text-[12.5px] text-muted">
        {t('settings.backup.restoreNote', { change: mode === 'merge' ? t('settings.backup.mergeHint') : t('settings.backup.replaceHint') })}
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          variant={mode === 'replace' ? 'danger' : 'primary'}
          disabled={!entry || busy || (entry.encrypted && !pass)}
          onClick={() => entry && void onRestore(entry, mode, entry.encrypted ? pass : undefined)}
        >
          {busy ? t('settings.backup.restoring') : t('settings.backup.restoreThis')}
        </Button>
      </div>
    </div>
  );
}

function GoogleDriveIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <path d="M8.2 3h7.6l6.2 10.8-3.8 6.6H5.8L2 13.8 8.2 3Z" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M8.2 3l6 10.8H22M15.8 3 9.6 13.8 5.8 20.4M2 13.8h12.2" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" />
    </svg>
  );
}
