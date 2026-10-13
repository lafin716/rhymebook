import {
  CLI_MODEL_PRESETS,
  EFFORT_LABELS,
  effortsFor,
  isCliId,
  normalizeSkillFilePath,
  PROVIDER_LABELS,
  SKILL_FILE_LIMITS,
  type ProviderId,
  type SkillFile,
} from '@branch/core';
import { ChevronRight, FilePlus2, FileText, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { caps } from '../app/capabilities';
import { useApp } from '../app/store';
import { Button, IconButton } from '../components/Button';
import { pushNotice as toast } from '../app/sync';
import { cn } from '../lib/cn';

/* ── 부수 파일 (IMP-12, ADR-038) ─────────────────────────── */

const FOLDER_HINTS = ['references/', 'scripts/', 'assets/'];

const fmtSize = (n: number) => (n < 1000 ? `${n}자` : `${(n / 1000).toFixed(1)}천 자`);

/**
 * 스킬 폴더의 부수 파일 목록·편집. Claude·Codex 스킬처럼 references/(참고 자료)·scripts/(예제 코드)·assets/(템플릿)에 둔다.
 * 파일은 스킬을 쓸 때 지시와 함께 모델에게 전달된다.
 */
export function SkillFilesField({
  files,
  onChange,
  onOpenFolder,
  folderHint,
}: {
  files: SkillFile[];
  onChange(files: SkillFile[]): void;
  /** 데스크톱: 스킬 폴더 열기 (없으면 버튼을 숨긴다) */
  onOpenFolder?: () => void;
  folderHint?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const total = files.reduce((n, f) => n + f.content.length, 0);
  const full = files.length >= SKILL_FILE_LIMITS.count;

  const add = (rawPath: string, content = '') => {
    const path = normalizeSkillFilePath(rawPath);
    if (!path || path.endsWith('/')) return false;
    const exists = files.some((f) => f.path.toLowerCase() === path.toLowerCase());
    if (exists) {
      toast('같은 경로의 파일이 이미 있어요.');
      return false;
    }
    onChange([...files, { path, content }].sort((a, b) => a.path.localeCompare(b.path)));
    setOpen(path);
    return true;
  };

  const onUpload = async (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      if (file.size > SKILL_FILE_LIMITS.file * 4) {
        toast(`${file.name}: 파일이 너무 커요.`);
        continue;
      }
      const text = await file.text();
      if (text.includes('\u0000')) {
        toast(`${file.name}: 텍스트 파일만 넣을 수 있어요.`);
        continue;
      }
      const dir = /\.(py|js|ts|sh|rb|go|java|c|cpp|rs)$/i.test(file.name) ? 'scripts/' : 'references/';
      add(`${dir}${file.name}`, text.slice(0, SKILL_FILE_LIMITS.file));
    }
    if (upload.current) upload.current.value = '';
  };

  return (
    <section aria-label="스킬 파일" data-skill-files className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <span className="text-[13px] font-medium text-fg-2">
          파일 <span className="font-normal text-muted">({files.length}개 · {fmtSize(total)})</span>
        </span>
        <span className="flex-1" />
        {onOpenFolder && (
          <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={onOpenFolder} title={folderHint}>
            폴더 열기
          </Button>
        )}
        <IconButton size="sm" label="파일 가져오기" disabled={full} onClick={() => upload.current?.click()}>
          <Upload size={15} />
        </IconButton>
        <IconButton size="sm" label="새 파일" disabled={full} onClick={() => setAdding('references/')}>
          <FilePlus2 size={15} />
        </IconButton>
        <input ref={upload} type="file" multiple hidden onChange={(e) => void onUpload(e.target.files)} />
      </div>

      {files.length === 0 && adding === null && (
        <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
          긴 참고 자료는 <code>references/</code>, 예제 코드는 <code>scripts/</code>, 답변 템플릿은 <code>assets/</code>에 두면 지시를 짧게 유지할 수 있어요. 파일은 이 스킬을 쓸 때 지시와 함께 모델에게 전달돼요.
        </p>
      )}

      {adding !== null && (
        // 스킬 편집 <form> 안이라 form을 겹치지 않고 Enter·버튼으로 추가한다
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            autoFocus
            aria-label="새 파일 경로"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setAdding(null);
              } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (add(adding)) setAdding(null);
              }
            }}
            placeholder="references/guide.md"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 font-mono text-[13px] outline-none focus:border-accent"
          />
          {FOLDER_HINTS.map((d) => (
            <button key={d} type="button" onClick={() => setAdding(d + (adding.split('/').pop() ?? ''))} className="rounded-full border border-line px-2 py-0.5 font-mono text-[11.5px] text-fg-2 hover:border-accent hover:text-accent">
              {d}
            </button>
          ))}
          <Button size="sm" variant="soft" onClick={() => add(adding) && setAdding(null)}>
            추가
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
            취소
          </Button>
        </div>
      )}

      {files.length > 0 && (
        <ul className="overflow-hidden rounded-xl border border-line bg-surface">
          {files.map((f, i) => (
            <li key={f.path} className={cn(i > 0 && 'border-t border-line')}>
              <div className="flex items-center gap-1 pr-1">
                <button
                  type="button"
                  data-skill-file={f.path}
                  aria-expanded={open === f.path}
                  onClick={() => setOpen(open === f.path ? null : f.path)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  <ChevronRight size={14} className={cn('shrink-0 text-muted transition-transform', open === f.path && 'rotate-90')} />
                  <FileText size={14} className="shrink-0 text-accent" />
                  <span className="truncate font-mono text-[13px]">{f.path}</span>
                  <span className="ml-auto shrink-0 pl-2 text-[11.5px] text-muted">{fmtSize(f.content.length)}</span>
                </button>
                <IconButton size="sm" label={`${f.path} 삭제`} onClick={() => onChange(files.filter((x) => x.path !== f.path))}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
              {open === f.path && (
                <textarea
                  aria-label={`${f.path} 내용`}
                  value={f.content}
                  maxLength={SKILL_FILE_LIMITS.file}
                  rows={12}
                  spellCheck={false}
                  onChange={(e) => onChange(files.map((x) => (x.path === f.path ? { ...x, content: e.target.value } : x)))}
                  className="block min-h-40 w-full resize-y border-t border-line bg-bg px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── 고급 옵션: 스킬 전용 provider·모델·노력치 (IMP-12) ───── */

export interface OptionsDraft {
  providerId: ProviderId | '';
  model: string;
  effort: string;
}

/** 웹·모바일은 PC 에이전트(CLI)만 고를 수 있다 (ADR-031) */
const choices = (): ProviderId[] => (caps.localCli ? caps.providers : ['claude-cli', 'codex-cli']);

const SELECT = 'h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[13.5px] outline-none focus:border-accent disabled:opacity-50';

export function SkillOptionsField({ value, onChange }: { value: OptionsDraft; onChange(v: OptionsDraft): void }) {
  const set = !!value.providerId;
  const [open, setOpen] = useState(set);
  const p = value.providerId;
  const conn = useApp((s) => (p ? s.connections[p] : undefined));
  const cli = p && isCliId(p) ? p : undefined;
  const presets = cli ? CLI_MODEL_PRESETS[cli] : [];
  const efforts = cli ? effortsFor(cli, value.model || conn?.model) : [];
  const extraModel = cli && value.model && !presets.some((x) => x.id === value.model) ? value.model : undefined;
  const remote = !caps.localCli;
  const label = (id: ProviderId) => (remote ? `PC · ${PROVIDER_LABELS[id]}` : PROVIDER_LABELS[id]);
  const summary = set ? [label(p as ProviderId), value.model, value.effort && (EFFORT_LABELS[value.effort] ?? value.effort)].filter(Boolean).join(' · ') : '세션 설정 따름';

  return (
    <section aria-label="고급 옵션" data-skill-options className="rounded-xl border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left">
        <ChevronRight size={15} className={cn('shrink-0 text-muted transition-transform', open && 'rotate-90')} />
        <span className="text-[13px] font-medium text-fg-2">고급 옵션</span>
        <span className={cn('ml-auto truncate text-[12px]', set ? 'text-accent' : 'text-muted')}>{summary}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line px-3 pt-3 pb-3.5">
          <Row label={remote ? '에이전트' : '프로바이더'}>
            <select
              aria-label="스킬 프로바이더"
              value={p}
              onChange={(e) => onChange({ providerId: e.target.value as ProviderId | '', model: '', effort: '' })}
              className={SELECT}
            >
              <option value="">세션 설정 따름</option>
              {choices().map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </Row>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Row label="모델">
              {!p || cli || p === 'remote-bridge' ? (
                <select
                  aria-label="스킬 모델"
                  disabled={!cli}
                  value={value.model}
                  onChange={(e) => {
                    const model = e.target.value;
                    const keep = cli && value.effort && effortsFor(cli, model || conn?.model).includes(value.effort);
                    onChange({ ...value, model, effort: keep ? value.effort : '' });
                  }}
                  className={SELECT}
                >
                  <option value="">{remote ? 'PC 기본 모델' : `연결 기본 모델${conn?.model ? ` (${conn.model})` : ''}`}</option>
                  {presets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                  {extraModel && <option value={extraModel}>{extraModel}</option>}
                </select>
              ) : (
                <input
                  aria-label="스킬 모델"
                  value={value.model}
                  placeholder={conn?.model || '연결 기본 모델'}
                  onChange={(e) => onChange({ ...value, model: e.target.value })}
                  className={cn(SELECT, 'font-mono')}
                />
              )}
            </Row>
            <Row label="노력치">
              <select aria-label="스킬 노력치" disabled={!cli} value={value.effort} onChange={(e) => onChange({ ...value, effort: e.target.value })} className={SELECT}>
                <option value="">{cli ? '기본 노력치' : '해당 없음'}</option>
                {efforts.map((x) => (
                  <option key={x} value={x}>
                    {EFFORT_LABELS[x] ?? x}
                  </option>
                ))}
              </select>
            </Row>
          </div>
          <p className="text-[12px] leading-snug text-muted">
            {set
              ? '이 스킬을 고른 질문은 위 설정으로 답해요. 그 뒤의 질문은 다시 세션 설정을 따라요. 모델·노력치를 비우면 그 연결의 기본값이에요.'
              : '비워 두면 채팅(세션)에서 고른 provider·모델·노력치를 그대로 써요. 이 스킬만 다른 모델로 답하게 하려면 고르세요.'}
          </p>
        </div>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-fg-2">{label}</span>
      {children}
    </label>
  );
}
