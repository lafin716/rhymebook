import {
  isPage,
  pageCardText,
  pageDoc,
  sessionCardText,
  type CanvasSource,
  type ID,
  type VaultItem,
  type VaultNode,
} from '@branch/core';
import { Archive, FileText, ImagePlus, MessageSquare, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { syncClient } from '../app/sync';
import { IconButton } from '../components/Button';
import { Modal } from '../components/Modal';
import { cn } from '../lib/cn';
import { pictureFromAttachment } from './canvasImage';

/** 캔버스로 가져올 수 있는 것 */
export type ImportSource = 'image' | 'session' | 'page' | 'vault';

/** 가져온 한 덩이: 글 카드 또는 그림 */
export type ImportEntry =
  | { kind: 'text'; title: string; text: string; source: CanvasSource }
  | { kind: 'image'; src: string; w: number; h: number; name: string };

const LOAD_TIMEOUT_MS = 20_000;

const OFFLINE = 'PC와 연결되어 있지 않아요. 연결된 뒤 다시 가져오세요.';

/** 원격 기기: 가져올 대화를 PC에서 받아 올 때까지 기다린다 (notes/study.ts loadTree와 같은 방식) */
export async function ensureLoaded(id: ID): Promise<void> {
  const c = syncClient;
  if (!c || c.state.getState().loaded[id]) return;
  if (c.state.getState().status !== 'online') throw new Error(OFFLINE);
  c.ensureMessages(id);
  await new Promise<void>((resolve, reject) => {
    let unsub = () => {};
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('PC에서 대화를 다 받지 못했어요. 잠시 후 다시 시도하세요.')), LOAD_TIMEOUT_MS);
    unsub = c.state.subscribe((s) => {
      if (s.status !== 'online') finish(new Error(OFFLINE));
      else if (s.loaded[id]) finish();
    });
    if (c.state.getState().loaded[id]) finish();
  });
}

export function ImportDialog({ label, title, onClose, children }: { label: string; title: string; onClose(): void; children: ReactNode }) {
  return (
    <Modal open onClose={onClose} label={label} className="md:max-w-md">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h3>
        <IconButton label="닫기" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">{children}</div>
    </Modal>
  );
}

const SOURCES: { source: ImportSource; label: string; hint: string; icon: ReactNode }[] = [
  { source: 'image', label: '이미지', hint: 'PNG·JPG·GIF·WebP 파일', icon: <ImagePlus size={18} /> },
  { source: 'session', label: '세션 내용', hint: '대화 한 개를 글 카드로', icon: <MessageSquare size={18} /> },
  { source: 'page', label: '페이지 내용', hint: '페이지 한 장을 글 카드로', icon: <FileText size={18} /> },
  { source: 'vault', label: '보관함', hint: '보관한 글이나 그림 고르기', icon: <Archive size={18} /> },
];

/** 가져오기 종류 고르기 */
export function ImportMenu({ onPick, onClose }: { onPick(source: ImportSource): void; onClose(): void }) {
  return (
    <ImportDialog label="가져오기 종류" title="캔버스에 가져오기" onClose={onClose}>
      <ul data-canvas-import-menu className="flex flex-col gap-1">
        {SOURCES.map((o) => (
          <li key={o.source}>
            <button
              type="button"
              data-canvas-import-source={o.source}
              onClick={() => onPick(o.source)}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-fg hover:bg-surface-2 md:min-h-9"
            >
              <span className="shrink-0 text-accent">{o.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[14px]">{o.label}</span>
                <span className="text-[12px] text-muted">{o.hint}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </ImportDialog>
  );
}

interface PickRowData {
  id: ID;
  title: string;
  sub: string;
  load(): Promise<ImportEntry>;
}

/** 세션·페이지·보관함 항목 고르기. 고르면 글 카드나 그림으로 바꿔 넘긴다 */
export function ImportPicker({ source, onPick, onClose }: { source: Exclude<ImportSource, 'image'>; onPick(entry: ImportEntry): void; onClose(): void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<ID | null>(null);
  const [error, setError] = useState('');
  const sessions = useApp((s) => s.sessions);
  const vault = useApp((s) => s.vault);

  const rows = useMemo<PickRowData[]>(() => {
    if (source === 'vault') {
      return Object.values(vault)
        .filter((n: VaultNode): n is VaultItem => n.kind === 'item')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((n) => ({
          id: n.id,
          title: n.name,
          sub: n.item.type === 'image' ? '그림' : '글',
          load: async (): Promise<ImportEntry> => {
            if (n.item.type === 'image') {
              const p = await pictureFromAttachment(n.item.attachment);
              return { kind: 'image', src: p.src, w: p.w, h: p.h, name: n.name };
            }
            return { kind: 'text', title: n.name, text: n.item.text, source: { kind: 'vault', id: n.id } };
          },
        }));
    }
    const list = Object.values(sessions)
      .filter((s) => (source === 'page' ? isPage(s) : !s.kind))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return list.map((s) => ({
      id: s.id,
      title: s.title,
      sub: new Date(s.updatedAt).toLocaleDateString('ko-KR'),
      load: async (): Promise<ImportEntry> => {
        await ensureLoaded(s.id);
        const msgs = actions().messages[s.id] ?? [];
        const text = source === 'page' ? pageCardText(pageDoc(msgs)?.content ?? '') : sessionCardText(msgs);
        return { kind: 'text', title: s.title, text, source: { kind: source, id: s.id } };
      },
    }));
  }, [source, sessions, vault]);

  const shown = rows.filter((r) => !q.trim() || r.title.toLowerCase().includes(q.trim().toLowerCase()));

  const choose = async (row: PickRowData) => {
    if (busy) return;
    setBusy(row.id);
    setError('');
    try {
      onPick(await row.load());
    } catch (e) {
      setError(e instanceof Error ? e.message : '가져오지 못했어요.');
      setBusy(null);
    }
  };

  const label = source === 'session' ? '세션 내용 가져오기' : source === 'page' ? '페이지 내용 가져오기' : '보관함에서 가져오기';
  const empty = source === 'page' ? '아직 페이지가 없어요.' : source === 'session' ? '가져올 대화가 없어요.' : '보관한 항목이 없어요.';

  return (
    <ImportDialog label={label} title={label} onClose={onClose}>
      <input
        aria-label="찾기"
        value={q}
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름으로 찾기"
        className="mb-1.5 h-10 w-full rounded-lg border border-line bg-bg px-2.5 text-[15px] outline-none focus:border-accent md:h-9 md:text-sm"
      />
      {error && <p role="alert" className="px-2 py-1.5 text-[13px] text-danger">{error}</p>}
      {shown.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13.5px] text-muted">{q.trim() ? '찾는 항목이 없어요.' : empty}</p>
      ) : (
        <ul data-canvas-import-picker>
          {shown.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => choose(r)}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[14px] text-fg hover:bg-surface-2 disabled:opacity-60 md:min-h-9',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="shrink-0 text-[12px] text-muted">{busy === r.id ? '가져오는 중…' : r.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ImportDialog>
  );
}
