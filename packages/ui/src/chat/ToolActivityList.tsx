import type { ToolActivity } from '@branch/core';
import { AlertTriangle, Check, ExternalLink, FileText, Globe, Loader2, Wrench } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';

const TOOL_LABELS: Record<string, string> = {
  web_search: '웹 검색',
  web_fetch: '페이지 읽기',
  code_execution: '코드 실행',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** 답변 위 도구 사용 내역 (ADR-070): 검색어·읽은 페이지와 출처 링크 */
export function ToolActivityList({ tools }: { tools: ToolActivity[] }) {
  if (!tools.length) return null;
  return (
    <div data-tools className="space-y-1">
      {tools.map((t) => (
        <ToolRow key={t.id} tool={t} />
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABELS[tool.name] ?? '도구 사용';
  const detail = tool.query ?? (tool.url ? hostOf(tool.url) : '');
  // 모델·검색 결과가 준 주소라 http(s)만 링크로 쓴다
  const sources = (tool.sources ?? []).filter((s) => /^https?:\/\//i.test(s.url));
  const Icon = tool.name === 'web_search' ? Globe : tool.name === 'web_fetch' ? FileText : Wrench;
  return (
    <div data-tool={tool.name} data-tool-status={tool.status} className="text-[13px] text-muted">
      <button
        type="button"
        disabled={!sources.length}
        aria-expanded={sources.length ? open : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left', sources.length > 0 && 'hover:text-fg')}
      >
        {tool.status === 'running' ? (
          <Loader2 size={13} className="shrink-0 animate-spin" />
        ) : tool.status === 'error' ? (
          <AlertTriangle size={13} className="shrink-0 text-danger" />
        ) : (
          <Icon size={13} className="shrink-0" />
        )}
        <span className="shrink-0 font-medium">{label}</span>
        {detail && <span className="truncate">{detail}</span>}
        {tool.status === 'error' && <span className="shrink-0">· 실패</span>}
        {tool.status === 'done' && sources.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-0.5">
            · <Check size={12} /> 출처 {sources.length}
          </span>
        )}
      </button>
      {open && sources.length > 0 && (
        <ul className="mt-1 ml-5 space-y-0.5 border-l border-line pl-3">
          {sources.map((s) => (
            <li key={s.url} className="min-w-0">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-accent hover:underline">
                <span className="truncate">{s.title || hostOf(s.url)}</span>
                <span className="shrink-0 text-muted">{hostOf(s.url)}</span>
                <ExternalLink size={11} className="shrink-0" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
