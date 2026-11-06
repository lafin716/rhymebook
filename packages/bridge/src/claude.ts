import { KB_TOOL_NAMES, t, providerError, type Attachment, type KbToolName, type StreamEvent, type ToolActivity, type ToolSource } from '@branch/core';
import { KB_MCP_TOOL_PREFIX } from './kbTools/config';
import { classifyCliError, type CliErrorContext } from './errors';
import { isObj, str, type CliParser } from './parser';
import type { RunResult } from './run';

export const CLAUDE_CTX: CliErrorContext = { label: 'Claude CLI', loginHint: 'claude auth login' };

/**
 * 공식 claude CLI 무상태 실행 인자 (03-PROVIDERS 정책).
 * 세션 저장 안 함, MCP/사용자 설정 미적용. 프롬프트는 stdin으로 넘긴다.
 * 도구는 기본 전부 비활성이다. webSearch면 웹 검색·페이지 읽기, knowledge면 지식베이스 읽기(Read·Glob·Grep)만 허용한다.
 * 셸·쓰기 도구는 계속 막는다 (ADR-070, ADR-107).
 * -p 모드는 권한 확인을 물을 수 없어 --allowedTools로 켠 도구만 미리 허용한다.
 * knowledgeDir는 --add-dir로 읽기 허용만 준다 (작업 폴더는 그대로 두어, 자료 폴더의 CLAUDE.md 등을 설정으로 읽지 않게 한다)
 */
export function claudeArgs(opts: {
  systemFile: string;
  model?: string;
  effort?: string;
  inputJson?: boolean;
  webSearch?: boolean;
  knowledge?: boolean;
  knowledgeDir?: string;
  /** 지식베이스 MCP 서버 (ADR-124). 있으면 Read·Glob·Grep·--add-dir 대신 이 도구만 쓴다 */
  kbMcp?: { config: string; tools: readonly string[] };
}): string[] {
  // --tools: 쓸 수 있는 도구 목록 (지식베이스 읽기 + 웹)
  // 지식베이스가 있으면 웹 도구를 끈다: 자료 속 지시문이 자료 내용을 외부 주소로 내보내지 못하게 (ADR-107)
  const web = opts.webSearch && !opts.knowledge && !opts.kbMcp;
  const toolList = [...(opts.knowledge ? CLAUDE_KNOWLEDGE_TOOLS : []), ...(web ? CLAUDE_WEB_TOOLS : [])].join(',');
  // --allowedTools: -p 모드에서 확인 없이 허용할 도구. 웹 도구만 둔다.
  // Read·Glob·Grep은 넣지 않는다 (넓게 허용하면 폴더 밖 파일도 읽힌다). 폴더 안 읽기는 --add-dir로 충분하다.
  // MCP 지식 도구는 읽기 전용이고 서버가 폴더 밖을 막으므로 이름으로 미리 허용한다.
  const allowList = [...(opts.kbMcp ? opts.kbMcp.tools : []), ...(web ? CLAUDE_WEB_TOOLS : [])].join(',');
  return [
    '-p',
    '--output-format',
    'stream-json',
    // 첨부(이미지·PDF)가 있으면 stdin으로 content 블록을 담은 사용자 메시지 한 줄을 넘긴다
    ...(opts.inputJson ? ['--input-format', 'stream-json'] : []),
    '--verbose',
    '--include-partial-messages',
    '--tools',
    toolList,
    ...(allowList ? ['--allowedTools', allowList] : []),
    '--system-prompt-file',
    opts.systemFile,
    '--no-session-persistence',
    // MCP는 우리 서버만 쓴다 (사용자 설정의 서버는 읽지 않는다)
    ...(opts.kbMcp ? ['--mcp-config', opts.kbMcp.config] : []),
    '--strict-mcp-config',
    '--setting-sources',
    '',
    ...(opts.model ? ['--model', opts.model] : []),
    ...(opts.effort ? ['--effort', opts.effort] : []),
    // 가변 인자 옵션이라 항상 마지막에 둔다
    ...(opts.knowledge && opts.knowledgeDir ? ['--add-dir', opts.knowledgeDir] : []),
  ];
}

const CLAUDE_WEB_TOOLS = ['WebSearch', 'WebFetch'];
/** 지식베이스 읽기 도구 (쓰기·셸 없음) */
const CLAUDE_KNOWLEDGE_TOOLS = ['Read', 'Glob', 'Grep'];

/** 지식베이스 폴더 안 경로면 그 폴더 기준 상대 경로로 (화면 표시용) */
function relativeTo(dir: string | undefined, p: string): string {
  if (!dir) return p;
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

/** 도구 입력에서 화면에 보일 대상 (검색어·파일 경로·패턴) */
function toolQuery(name: string, input: Record<string, unknown>, knowledgeDir?: string): string | undefined {
  if (name === 'Read') return str(input.file_path) ? relativeTo(knowledgeDir, str(input.file_path)!) : undefined;
  if (name === 'Glob' || name === 'Grep') return str(input.pattern);
  return str(input.query);
}

/** CLI 도구 이름 → 앱 도구 이름 */
function toolName(name: string): string {
  return name === 'WebSearch' ? 'web_search' : name === 'WebFetch' ? 'web_fetch' : name.toLowerCase();
}

/** mcp__octobooks__<tool> → <tool> (지식베이스 도구가 아니면 undefined) */
export function kbToolNameOf(raw: string): KbToolName | undefined {
  if (!raw.startsWith(KB_MCP_TOOL_PREFIX)) return undefined;
  const n = raw.slice(KB_MCP_TOOL_PREFIX.length);
  return (KB_TOOL_NAMES as readonly string[]).includes(n) ? (n as KbToolName) : undefined;
}

/** CLI의 tool_use_result에서 출처 목록 (WebSearch: results[].content[], WebFetch: url) */
function toolSources(result: unknown): ToolSource[] {
  if (!isObj(result)) return [];
  const out: ToolSource[] = [];
  if (Array.isArray(result.results)) {
    for (const r of result.results) {
      if (!isObj(r) || !Array.isArray(r.content)) continue;
      for (const c of r.content) {
        const url = isObj(c) ? str(c.url) : undefined;
        if (url) out.push({ url, ...(isObj(c) && str(c.title) ? { title: str(c.title)! } : {}) });
      }
    }
  } else if (str(result.url)) {
    out.push({ url: str(result.url)! });
  }
  return out;
}

/** --input-format stream-json용 stdin: 첨부 블록 + 프롬프트를 담은 사용자 메시지 한 줄 */
export function claudeJsonInput(prompt: string, attachments: readonly Attachment[]): string {
  const content = [
    ...attachments.map((a) => ({
      type: a.kind === 'image' ? 'image' : 'document',
      source: { type: 'base64', media_type: a.kind === 'image' ? a.mime : 'application/pdf', data: a.data },
    })),
    { type: 'text', text: prompt },
  ];
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (isObj(b) && b.type === 'text' ? (str(b.text) ?? '') : ''))
    .join('');
}

export function createClaudeParser(opts: { knowledgeDir?: string } = {}): CliParser {
  let sawPartial = false;
  let emitted = false;
  /** 도구 사용이나 새 메시지 뒤 첫 글이면 앞 글과 문단을 나눈다 */
  let needBreak = false;
  /** 오류 시 CLI가 만드는 합성 메시지(model "<synthetic>")의 문구 */
  let synthetic = '';
  /** 시작을 알린 도구 (id → 도구) */
  const tools = new Map<string, ToolActivity>();

  const text = (t: string): StreamEvent[] => {
    const lead = needBreak && emitted ? '\n\n' : '';
    needBreak = false;
    emitted = true;
    return [{ type: 'delta', text: lead + t }];
  };

  return {
    line(obj) {
      if (!isObj(obj)) return [];
      if (obj.type === 'stream_event' && isObj(obj.event)) {
        const ev = obj.event;
        if (ev.type === 'content_block_delta' && isObj(ev.delta) && ev.delta.type === 'text_delta') {
          const t = str(ev.delta.text) ?? '';
          if (!t) return [];
          sawPartial = true;
          return text(t);
        }
        if (ev.type === 'message_start') needBreak = true;
        return [];
      }
      if (obj.type === 'assistant' && isObj(obj.message)) {
        const t = textOf(obj.message.content);
        if (obj.message.model === '<synthetic>') {
          synthetic = t;
          return [];
        }
        const out: StreamEvent[] = [];
        for (const b of Array.isArray(obj.message.content) ? obj.message.content : []) {
          if (!isObj(b) || b.type !== 'tool_use') continue;
          const id = str(b.id);
          if (!id || tools.has(id)) continue;
          const input = isObj(b.input) ? b.input : {};
          const rawName = str(b.name) ?? 'tool';
          const kbName = kbToolNameOf(rawName);
          const q = kbName ? (str(input.query) ?? str(input.path)) : toolQuery(rawName, input, opts.knowledgeDir);
          const tool: ToolActivity = {
            id,
            name: kbName ?? toolName(rawName),
            status: 'running',
            ...(q ? { query: q } : {}),
            ...(str(input.url) ? { url: str(input.url)! } : {}),
          };
          tools.set(id, tool);
          needBreak = true;
          out.push({ type: 'tool', tool });
        }
        // 부분 메시지가 꺼져 있거나 오지 않았을 때만 완성 메시지를 쓴다
        if (sawPartial || !t) return out;
        return [...text(t), ...out];
      }
      if (obj.type === 'user' && isObj(obj.message) && Array.isArray(obj.message.content)) {
        const out: StreamEvent[] = [];
        for (const b of obj.message.content) {
          if (!isObj(b) || b.type !== 'tool_result') continue;
          const prev = tools.get(str(b.tool_use_id) ?? '');
          if (!prev) continue;
          const sources = toolSources(obj.tool_use_result);
          const query = isObj(obj.tool_use_result) ? str(obj.tool_use_result.query) : undefined;
          out.push({
            type: 'tool',
            tool: {
              ...prev,
              status: b.is_error === true ? 'error' : 'done',
              ...(query && !prev.query ? { query } : {}),
              ...(sources.length ? { sources } : {}),
            },
          });
        }
        return out;
      }
      if (obj.type === 'result') {
        const isError = obj.is_error === true || (str(obj.subtype) ?? 'success') !== 'success' || !!synthetic;
        if (isError) {
          const errors = Array.isArray(obj.errors) ? obj.errors.filter((e) => typeof e === 'string').join(' ') : '';
          const raw = [str(obj.result), synthetic, errors, str(obj.subtype)].filter(Boolean).join(' ');
          return [{ type: 'error', error: classifyCliError(raw, CLAUDE_CTX) }];
        }
        if (!emitted && str(obj.result)) {
          return [{ type: 'delta', text: str(obj.result)! }, done(obj.stop_reason)];
        }
        return [done(obj.stop_reason)];
      }
      return [];
    },
    finish(res) {
      return finishFromExit(res, synthetic, CLAUDE_CTX);
    },
  };
}

function done(stopReason: unknown): StreamEvent {
  const s = str(stopReason);
  return { type: 'done', ...(s ? { stopReason: s } : {}) };
}

/** 종료 이벤트 없이 프로세스가 끝났을 때 */
export function finishFromExit(res: RunResult, extra: string, ctx: CliErrorContext): StreamEvent {
  if (res.aborted) return { type: 'error', error: providerError('aborted', t('bridge.common.stopped')) };
  if (res.notFound) return { type: 'error', error: providerError('cli', t('bridge.claude.notFound', { label: ctx.label })) };
  if (res.timedOut) return { type: 'error', error: providerError('network', t('bridge.claude.timedOut', { label: ctx.label })) };
  return { type: 'error', error: classifyCliError([extra, res.stderr].filter(Boolean).join(' ') || t('bridge.claude.exitCode', { code: String(res.code ?? '?') }), ctx) };
}
