import type { ID, VaultItemContent, VaultNode } from '@branch/core';
import { AudioLines, FileText, Folder, FolderOpen, Image as ImageIcon, LayoutTemplate, Play, Square } from 'lucide-react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { actions } from '../app/store';
import { dataUrl } from '../chat/attach';
import { Markdown } from '../chat/Markdown';
import { Button } from '../components/Button';
import { confirm } from '../components/ConfirmDialog';
import { cn } from '../lib/cn';
import { speakAll, stopSpeaking, useSpeech } from '../voice/speak';

const LANG_LABEL = { vi: '베트남어', en: '영어', ko: '한국어' } as const;
export const put = (node: VaultNode) => actions().putVaultNode(node);

/** 저장하지 않은 수정을 버릴지 묻는다 */
export const confirmDiscard = () =>
  confirm({ title: '저장하지 않은 변경을 버릴까요?', message: '수정한 내용이 사라져요.', confirmLabel: '버리기', tone: 'danger' });

export function NodeIcon({ node, open, size = 15 }: { node: VaultNode; open?: boolean; size?: number }) {
  if (node.kind === 'folder') return open ? <FolderOpen size={size} className="shrink-0 text-accent" /> : <Folder size={size} className="shrink-0 text-accent" />;
  if (node.kind === 'page') return <LayoutTemplate size={size} className="shrink-0 text-accent" />;
  const t = node.item.type;
  const cls = 'shrink-0 text-muted';
  return t === 'image' ? <ImageIcon size={size} className={cls} /> : t === 'audio' ? <AudioLines size={size} className={cls} /> : <FileText size={size} className={cls} />;
}

/** 폴더 경로 이름 ("상위 / 하위") */
export function folderPath(vault: Record<ID, VaultNode>, id: ID): string {
  const names: string[] = [];
  let cur: VaultNode | undefined = vault[id];
  for (let i = 0; cur && i < 20; i++) {
    names.unshift(cur.name);
    cur = cur.parentId ? vault[cur.parentId] : undefined;
  }
  return names.join(' / ');
}

/** 조각 내용 (글은 Markdown, 이미지는 그림, 음성은 듣기 버튼과 글) */
export function ItemContent({ item, playKey }: { item: VaultItemContent; playKey: string }) {
  const status = useSpeech((s) => s.status);
  const current = useSpeech((s) => s.key);
  if (item.type === 'text') {
    return (
      <div className="md">
        <Markdown content={item.text} />
      </div>
    );
  }
  if (item.type === 'image') {
    return <img src={dataUrl(item.attachment)} alt={item.attachment.name} className="max-h-[28rem] w-auto max-w-full rounded-xl border border-line object-contain" />;
  }
  const playing = status !== 'idle' && !!current?.startsWith(`${playKey}#`);
  const lines = item.text.split('\n').filter((l) => l.trim());
  return (
    <div data-vault-audio className="overflow-hidden rounded-2xl border border-accent/25 bg-surface">
      <div className="flex items-center gap-2 border-b border-line bg-accent-soft/60 px-3 py-2">
        <AudioLines size={15} className="shrink-0 text-accent" />
        <span className="flex-1 text-[13px] text-muted">{LANG_LABEL[item.lang]}</span>
        <Button
          size="sm"
          variant={playing ? 'secondary' : 'soft'}
          icon={playing ? <Square size={13} /> : <Play size={14} />}
          onClick={() => (playing ? stopSpeaking() : speakAll(lines.map((text, i) => ({ text, lang: item.lang, key: `${playKey}#${i}` }))))}
        >
          {playing ? '멈춤' : '듣기'}
        </Button>
      </div>
      <div className="space-y-1 px-3 py-2.5 text-[15px] leading-snug text-fg">
        {lines.map((l, i) => (
          <p key={i} className={cn('break-words', status !== 'idle' && current === `${playKey}#${i}` && 'text-accent')}>
            {l}
          </p>
        ))}
      </div>
    </div>
  );
}

/** 끌고 있는 것을 손가락·커서 옆에 띄운다 */
export function DragGhost({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return createPortal(
    <div
      data-vault-ghost
      className="pointer-events-none fixed z-[90] flex max-w-[14rem] items-center gap-1.5 rounded-lg border border-accent/40 bg-surface px-2.5 py-1.5 text-[13px] shadow-float"
      style={{ left: x + 14, top: y - 42 }}
    >
      {children}
    </div>,
    document.body,
  );
}
