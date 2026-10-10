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
import { Field, Section, Segmented, Toggle } from './controls';

/** 설정 › 백업 탭. 상태와 동작은 backup/service (ADR-015) */
/** 대상마다 파일 이름이 같을 수 있어 대상 id를 붙인다 */
const entryKey = (e: BackupEntry) => `${e.targetId}|${e.id}`;
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
            <div className="text-[14.5px] font-medium">{last ? `마지막 백업 ${relativeTime(last.at)}` : '아직 백업이 없어요'}</div>
            <div className="text-[12.5px] text-muted">
              {last ? `${BACKUP_TARGET_LABEL[last.targetId]} · ${formatSize(last.size)}` : '대화·가지·앵커·요약·보기 상태를 하나의 파일로 저장합니다.'}
            </div>
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <Button size="sm" variant="secondary" className="flex-1 sm:flex-none" icon={<History size={14} />} onClick={() => setRestoring((r) => !r)} aria-expanded={restoring}>
              복원
            </Button>
            <Button size="sm" variant="primary" className="flex-1 sm:flex-none" icon={<Upload size={14} className={busy ? 'animate-pulse' : ''} />} onClick={() => void backupNow()} disabled={!!s.busy}>
              {busy ? '백업 중…' : '지금 백업'}
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

      <Section title="백업 위치" hint="여러 곳을 켜 두면 모두에 저장합니다. 실시간 동기화가 아니라 시점별 사본입니다.">
        <TargetCard icon={<HardDrive size={18} />} title="파일 (이 기기)" status="항상 사용 가능" tone="ok">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Download size={14} />} onClick={() => void exportFile()}>
              JSON 내보내기
            </Button>
            <Button size="sm" variant="ghost" icon={<FileJson size={14} />} onClick={() => fileInput.current?.click()}>
              파일에서 가져오기
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="백업 파일 선택"
              onChange={(e) => {
                void onImport(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
        </TargetCard>

        <TargetCard
          icon={<GoogleDriveIcon />}
          title="구글 드라이브"
          status={gdrive ? `${gdrive} · 연결됨` : '연결 안 됨'}
          tone={gdrive ? 'ok' : 'neutral'}
          badge={primary === 'gdrive' ? '자동 백업 대상' : undefined}
        >
          {gdrive ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
              <span>앱 전용 숨김 폴더에만 접근합니다. 다른 드라이브 파일은 볼 수 없어요.</span>
              <Button size="sm" variant="ghost" onClick={() => void disconnectDrive()}>
                연결 해제
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="soft" onClick={() => void connectDrive()} disabled={!!s.busy}>
              Google 계정 연결
            </Button>
          )}
        </TargetCard>

        <TargetCard
          icon={<FolderGit2 size={18} />}
          title="GitHub 저장소"
          status={github ? `${github} · 연결됨` : '연결 안 됨'}
          tone={github ? 'ok' : 'neutral'}
          badge={primary === 'github' ? '자동 백업 대상' : undefined}
        >
          {github ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
              <span>backup.json과 읽기용 마크다운을 커밋합니다.</span>
              <Button size="sm" variant="ghost" onClick={() => void disconnectGithub()}>
                연결 해제
              </Button>
            </div>
          ) : (
            <GithubForm initialRepo={s.githubRepo ?? ''} busy={s.busy === 'connect'} onConnect={connectGithub} />
          )}
        </TargetCard>
      </Section>

      <Field label="자동 백업" hint="변경 시: 편집이 멈추고 몇 분 뒤 저장합니다.">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<AutoBackupMode>
            value={auto}
            options={[
              ['off', '끄기'],
              ['change', '변경 시'],
              ['daily', '매일'],
            ]}
            onChange={(v) => setPrefs({ auto: v })}
          />
          <label className="flex items-center gap-2 text-[13px] text-fg-2">
            최근
            <select
              value={keep}
              onChange={(e) => setPrefs({ keep: Number(e.target.value) })}
              className="h-8 rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-accent"
            >
              {[5, 10, 30].map((n) => (
                <option key={n} value={n}>
                  {n}개
                </option>
              ))}
            </select>
            보관
          </label>
        </div>
      </Field>

      <div>
        <div className="flex items-center gap-3">
          <Lock size={16} className="shrink-0 text-fg-2" />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-medium">암호로 백업 잠그기</div>
            <p className="text-[12.5px] text-muted">백업 파일을 기기에서 암호화한 뒤 내보냅니다.</p>
          </div>
          <Toggle checked={encrypt} onChange={(v) => setPrefs({ encrypt: v })} label="백업 암호화" />
        </div>
        {encrypt && (
          <div className="mt-2 space-y-2 pl-7">
            <input
              type="password"
              value={s.passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="백업 암호"
              aria-label="백업 암호"
              autoComplete="new-password"
              className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent"
            />
            <p className="flex items-start gap-1.5 text-[12px] text-warn">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              암호를 잊으면 백업을 복원할 수 없어요. 암호는 저장되지 않습니다.
            </p>
          </div>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[12px] text-muted">
        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
        API 키·페어링 키·로그인 토큰은 백업에 포함되지 않습니다. 웹에서는 드라이브/GitHub 연결도 이 탭의 메모리에만 보관합니다.
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
          placeholder="owner/repo (비공개 권장)"
          aria-label="GitHub 저장소"
          className="h-9 min-w-0 shrink-0 rounded-lg border border-line bg-bg px-3 text-[13px] sm:flex-1 outline-none focus:border-accent"
        />
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          aria-label="GitHub 토큰"
          autoComplete="off"
          className="h-9 min-w-0 shrink-0 rounded-lg border border-line bg-bg px-3 font-mono sm:flex-1 text-[13px] outline-none placeholder:font-sans focus:border-accent"
        />
        <Button size="sm" variant="primary" type="submit" disabled={!ok} className="h-9">
          {busy ? '확인 중…' : '연결'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
      <p className="text-[12px] text-muted">이 저장소 하나에 Contents 읽기/쓰기 권한만 준 fine-grained 토큰을 쓰세요.</p>
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
        아직 백업이 없어요. 지금 백업하거나 파일에서 가져오세요.
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <ul className="max-h-60 divide-y divide-line overflow-y-auto rounded-xl border border-line" role="radiogroup" aria-label="복원할 백업">
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
                {new Date(v.at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
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
          placeholder="이 백업의 암호"
          aria-label="복원할 백업의 암호"
          autoComplete="current-password"
          className="h-9 w-full rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-accent"
        />
      )}
      <Segmented<RestoreMode>
        value={mode}
        options={[
          ['merge', '합치기'],
          ['replace', '전체 교체'],
        ]}
        onChange={setMode}
      />
      <p className="text-[12.5px] text-muted">
        {mode === 'merge' ? '같은 세션은 더 최근에 수정된 쪽을 남기고, 없는 세션은 추가합니다.' : '지금 기기의 모든 대화를 백업 내용으로 바꿉니다.'} 복원 전에 현재
        상태를 자동으로 백업해 둡니다.
      </p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          취소
        </Button>
        <Button
          size="sm"
          variant={mode === 'replace' ? 'danger' : 'primary'}
          disabled={!entry || busy || (entry.encrypted && !pass)}
          onClick={() => entry && void onRestore(entry, mode, entry.encrypted ? pass : undefined)}
        >
          {busy ? '복원 중…' : '이 백업으로 복원'}
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
