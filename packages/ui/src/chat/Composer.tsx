import {
  effectiveProviderId,
  filterSkills,
  isCliId,
  isLongPaste,
  nextFallback,
  parseSlash,
  PROVIDER_LABELS,
  skillRef,
  slashQuery,
  type Attachment,
  type ID,
  type Skill,
  type SkillRef,
} from '@branch/core';
import { ArrowUp, ImagePlus, Paperclip, Plus, Settings2, Sparkles, Square, WandSparkles, WifiOff, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { actions, useApp } from '../app/store';
import { pushNotice } from '../app/sync';
import { Button } from '../components/Button';
import { PcOfflineBanner, usePcOnline } from '../components/PcStatus';
import { caps, remoteMode } from '../app/capabilities';
import { cn } from '../lib/cn';
import { MicButton } from '../voice/MicButton';
import { isUsable, providerLabel, STATUS_LABEL } from '../lib/connection';
import { openSkillsWithAI, useSkills } from '../skills/skillsStore';
import { fileToAttachment, pastedTextAttachment } from './attach';
import { AttachmentList } from './Attachments';
import { ModelChips } from './ModelChips';

const FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.ts,.tsx,.js,.jsx,.py,.java,.go,.rs,.c,.cpp,.h,.cs,.rb,.php,.swift,.kt,.sql,.yaml,.yml,.toml,.xml,.html,.css,.sh,.log';

export function Composer({ sessionId, compact }: { sessionId: ID; compact?: boolean }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [skill, setSkill] = useState<SkillRef | null>(null);
  const [menu, setMenu] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 비동기 파일 읽기 중에도 최신 첨부 목록으로 제한을 확인한다
  const attachRef = useRef<Attachment[]>([]);
  attachRef.current = attachments;
  const streaming = useApp((s) => !!s.streaming[sessionId]);
  const isBranch = useApp((s) => !!s.sessions[sessionId]?.parentId);
  const eff = useApp((s) => effectiveProviderId(s, sessionId));
  const conn = useApp((s) => s.connections[eff]);
  const fallback = useApp((s) => (isUsable(s.connections[eff]) ? null : nextFallback(s, eff)));
  const skills = useSkills((s) => s.skills);
  const pcOnline = usePcOnline();
  const usable = isUsable(conn);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  // 슬래시 명령 입력 중이면 스킬 후보
  const query = skill ? null : slashQuery(text);
  const slashItems = query === null || slashClosed ? [] : filterSkills(skills, query).slice(0, 8);
  const slashOpen = slashItems.length > 0;
  useEffect(() => setSlashIndex(0), [query]);

  const addAttachment = (a: Attachment | string) => {
    if (typeof a === 'string') {
      pushNotice(a);
      return;
    }
    attachRef.current = [...attachRef.current, a];
    setAttachments(attachRef.current);
  };

  const addFiles = async (files: Iterable<File>) => {
    for (const f of files) addAttachment(await fileToAttachment(f, attachRef.current));
    ref.current?.focus();
  };

  const pickSkill = (s: Skill) => {
    setSkill(skillRef(s));
    setMenu(false);
    if (slashQuery(text) !== null) setText('');
    ref.current?.focus();
  };

  const canSend = !!(text.trim() || attachments.length || skill) && !(remoteMode && !pcOnline);

  /** 음성 전사 결과를 입력창 끝에 붙인다 (ADR-045) */
  const appendSpoken = (spoken: string) => {
    setText((t) => (t.trim() ? `${t.replace(/\s+$/, '')} ${spoken}` : spoken));
    ref.current?.focus();
  };

  const send = () => {
    if (!canSend || streaming) return;
    let body = text.trim();
    let use = skill;
    // `/명령 나머지`로 보내면 그 스킬을 적용한다 (모르는 명령은 그대로 보낸다)
    if (!use) {
      const cmd = parseSlash(body);
      const hit = cmd ? skills.find((s) => s.name === cmd.name) : undefined;
      if (cmd && hit) {
        use = skillRef(hit);
        body = cmd.rest;
      }
    }
    if (!body && !attachments.length) body = use?.title ?? '';
    const ok = actions().sendMessage(sessionId, body, undefined, {
      ...(attachments.length ? { attachments } : {}),
      ...(use ? { skill: use } : {}),
    });
    if (!ok) return;
    setText('');
    setAttachments([]);
    setSkill(null);
    setSlashClosed(false);
  };

  return (
    <div className={cn('shrink-0 bg-bg', compact ? 'px-2.5 pt-1.5 pb-2.5' : 'safe-bottom px-3 pt-2 pb-3 md:px-6')}>
      <div className="relative mx-auto max-w-3xl">
        {/* 원격 모드: 응답 가능 여부는 PC 연결이 결정한다 (어떤 CLI를 쓸지는 PC가 정함) */}
        {remoteMode && !pcOnline && <PcOfflineBanner />}
        {!remoteMode && !usable && (
          <div role="status" className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
            <WifiOff size={15} className="shrink-0" />
            <span className="min-w-[14rem] flex-1">
              <b className="font-semibold">{providerLabel(eff)}</b> {conn?.enabled === false ? '꺼짐' : STATUS_LABEL[conn?.status ?? 'offline']} — 지금은 응답을 받을 수 없어요
            </span>
            <span className="ml-auto flex gap-1.5">
              {fallback && (
                <Button size="sm" variant="secondary" onClick={() => actions().setSessionProvider(sessionId, fallback)}>
                  {providerLabel(fallback)}로 전환
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={<Settings2 size={14} />} onClick={() => actions().setOverlay('settings')}>
                설정
              </Button>
            </span>
          </div>
        )}

        {slashOpen && (
          <div role="listbox" aria-label="스킬" className="animate-pop-in absolute inset-x-0 bottom-full z-20 mb-1.5 overflow-hidden rounded-xl border border-line bg-elev p-1 shadow-float">
            <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-medium text-muted">스킬 · ↑↓ 선택 · Enter</div>
            {slashItems.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === slashIndex}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => pickSkill(s)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left', i === slashIndex && 'bg-surface-2')}
              >
                <Sparkles size={15} className="shrink-0 text-accent" />
                <code className="shrink-0 text-[13px] text-accent">/{s.name}</code>
                <span className="min-w-0 flex-1 truncate text-[13px] text-fg-2">{s.title}</span>
              </button>
            ))}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            void addFiles(e.dataTransfer.files);
          }}
          className="rounded-2xl border border-line bg-surface p-1.5 shadow-pop focus-within:border-line-strong"
        >
          {(attachments.length > 0 || skill) && (
            <div className="flex flex-col gap-1.5 px-1.5 pt-1.5 pb-1">
              {skill && (
                <span data-skill-chip={skill.name} className="inline-flex h-7 max-w-full items-center gap-1.5 self-start rounded-full border border-accent/40 bg-accent-soft pr-1 pl-2.5 text-[12.5px] text-accent">
                  <Sparkles size={13} />
                  <span className="truncate font-medium">{skill.title}</span>
                  <code className="text-[11.5px] opacity-75">/{skill.name}</code>
                  {/* 웹·모바일에서 PC CLI가 아닌 설정은 PC가 따르지 않아 보이지 않는다 */}
                  {skill.options && (caps.localCli || isCliId(skill.options.providerId)) && (
                    <span className="truncate text-[11.5px] opacity-75" title="이 스킬 전용 설정으로 답해요">
                      · {[PROVIDER_LABELS[skill.options.providerId], skill.options.model, skill.options.effort].filter(Boolean).join(' · ')}
                    </span>
                  )}
                  <button type="button" aria-label="스킬 빼기" onClick={() => setSkill(null)} className="grid size-5 place-items-center rounded-full hover:bg-accent/15">
                    <X size={12} />
                  </button>
                </span>
              )}
              <AttachmentList items={attachments} onRemove={(id) => setAttachments((cur) => cur.filter((a) => a.id !== id))} />
            </div>
          )}
          <div className="flex items-end gap-1.5">
            <PlusMenu
              open={menu}
              setOpen={setMenu}
              skills={skills}
              onPhoto={() => photoRef.current?.click()}
              onFile={() => fileRef.current?.click()}
              onSkill={pickSkill}
            />
            <textarea
              ref={ref}
              rows={1}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSlashClosed(false);
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                  return;
                }
                const pasted = e.clipboardData.getData('text/plain');
                if (pasted && isLongPaste(pasted)) {
                  e.preventDefault();
                  addAttachment(pastedTextAttachment(pasted, attachRef.current));
                }
              }}
              onKeyDown={(e) => {
                if (slashOpen) {
                  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const n = slashItems.length;
                    setSlashIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    pickSkill(slashItems[slashIndex] ?? slashItems[0]!);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSlashClosed(true);
                    return;
                  }
                }
                if (e.key === 'Backspace' && !text && skill) {
                  setSkill(null);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !('ontouchstart' in window)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={skill ? `${skill.title}: 주제나 요청을 적어 주세요…` : isBranch ? '이 가지에서 더 물어보기…' : '무엇이든 물어보세요… (/ 스킬)'}
              aria-label="메시지 입력"
              className="max-h-[180px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted"
            />
            <MicButton disabled={remoteMode && !pcOnline} onText={appendSpoken} />
            {streaming ? (
              <button
                type="button"
                aria-label="응답 중지"
                onClick={() => actions().stopStream(sessionId)}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-fg text-bg"
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="보내기"
                disabled={!canSend}
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-opacity disabled:opacity-35"
              >
                <ArrowUp size={18} />
              </button>
            )}
          </div>
          <input
            ref={photoRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            data-testid="photo-input"
            onChange={(e) => {
              if (e.target.files) void addFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            hidden
            data-testid="file-input"
            onChange={(e) => {
              if (e.target.files) void addFiles(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
        </form>
        {!remoteMode && <ModelChips sessionId={sessionId} compact={compact} />}
      </div>
    </div>
  );
}

/** 입력창 앞 + 메뉴: 사진·파일 첨부, 스킬 고르기, 스킬 관리 */
function PlusMenu({
  open,
  setOpen,
  skills,
  onPhoto,
  onFile,
  onSkill,
}: {
  open: boolean;
  setOpen(v: boolean): void;
  skills: Skill[];
  onPhoto(): void;
  onFile(): void;
  onSkill(s: Skill): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, setOpen]);

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-fg outline-none hover:bg-surface-2 focus:bg-surface-2';
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        aria-label="첨부·스킬"
        title="사진·파일 첨부, 스킬"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-xl transition-colors',
          open ? 'bg-accent-soft text-accent' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
        )}
      >
        <Plus size={19} className={cn('transition-transform', open && 'rotate-45')} />
      </button>
      {open && (
        <div role="menu" aria-label="첨부·스킬" className="animate-pop-in absolute bottom-full left-0 z-30 mb-2 w-64 rounded-xl border border-line bg-elev p-1 shadow-float">
          <MenuItem className={item} icon={<ImagePlus size={16} className="text-muted" />} onClick={run(onPhoto)}>
            사진 첨부
          </MenuItem>
          <MenuItem className={item} icon={<Paperclip size={16} className="text-muted" />} onClick={run(onFile)}>
            파일 첨부
          </MenuItem>
          <div className="my-1 h-px bg-line" />
          <div className="px-2.5 pt-1 pb-1 text-[11.5px] font-medium text-muted">스킬</div>
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {skills.length === 0 && <div className="px-2.5 py-1.5 text-[12.5px] text-muted">스킬이 없어요</div>}
            {skills.map((s) => (
              <MenuItem key={s.id} className={item} icon={<Sparkles size={16} className="text-accent" />} onClick={run(() => onSkill(s))}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.title}</span>
                  <code className="block truncate text-[11.5px] text-muted">/{s.name}</code>
                </span>
              </MenuItem>
            ))}
          </div>
          <MenuItem className={item} icon={<WandSparkles size={16} className="text-accent" />} onClick={run(openSkillsWithAI)}>
            AI로 스킬 만들기…
          </MenuItem>
          <MenuItem className={item} icon={<Settings2 size={16} className="text-muted" />} onClick={run(() => actions().setOverlay('skills'))}>
            스킬 관리…
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({ className, icon, onClick, children }: { className: string; icon: ReactNode; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={className}>
      {icon}
      {children}
    </button>
  );
}
