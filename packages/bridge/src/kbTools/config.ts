import { KB_TOOL_LIMITS } from '@branch/core';

/** MCP 서버 이름. 도구 전체 이름은 mcp__octobooks__<tool> */
export const KB_MCP_SERVER_NAME = 'octobooks';
export const KB_MCP_TOOL_PREFIX = `mcp__${KB_MCP_SERVER_NAME}__`;
/** 한 번의 채팅에 붙일 수 있는 KB 수 상한 */
export const KB_MAX_KBS_PER_CHAT = 8;

/** 실행 경로와 인자. 데스크톱 main.ts가 Electron 실행 파일 + kbMcp.cjs로 채운다 */
export interface KbToolsLauncher {
  command: string;
  /** 앞쪽 인자 (예: kbMcp.cjs 경로). 뒤에 --root, --kb가 붙는다 */
  args: string[];
  env?: Record<string, string>;
  /** knowledge 루트 (<root>/<kbId>/files) */
  root: string;
}

const kbIdSchema = { type: 'string', description: 'Knowledge base id from the system note.' };
const pathSchema = { type: 'string', description: 'Relative path inside the knowledge base files folder. Empty means root. No ".." or absolute paths.' };

export const KB_TOOL_DEFINITIONS = [
  {
    name: 'searchKnowledge',
    description: 'Keyword search across the selected knowledge bases. Returns ranked excerpts with paths and line ranges.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: KB_TOOL_LIMITS.queryMaxChars },
        kbIds: { type: 'array', items: kbIdSchema, maxItems: KB_TOOL_LIMITS.maxKbIds },
        limit: { type: 'integer', minimum: 1, maximum: KB_TOOL_LIMITS.searchMaxLimit },
        pathPrefix: pathSchema,
      },
      required: ['query'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'Search knowledge' },
  },
  {
    name: 'listKnowledgeDirectory',
    description: 'List files and folders in one folder of a knowledge base. Pass nextCursor back as cursor for more.',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: kbIdSchema,
        path: pathSchema,
        cursor: { type: 'string' },
      },
      required: ['kbId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'List knowledge folder' },
  },
  {
    name: 'readKnowledgeFile',
    description: `Read a text file by line range (max ${KB_TOOL_LIMITS.readMaxLines} lines per call).`,
    inputSchema: {
      type: 'object',
      properties: {
        kbId: kbIdSchema,
        path: pathSchema,
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
      required: ['kbId', 'path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'Read knowledge file' },
  },
  {
    name: 'getKnowledgeOutline',
    description: 'Headings and declarations of a file, or the child list of a folder.',
    inputSchema: {
      type: 'object',
      properties: { kbId: kbIdSchema, path: pathSchema },
      required: ['kbId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, title: 'Knowledge outline' },
  },
] as const;

/** MCP 서버 기동 제한 시간 (초). Codex -c mcp_servers.<name>.startup_timeout_sec */
export const KB_MCP_STARTUP_SEC = 10;
/** 도구 한 번의 제한 시간 (초). 서버 안의 호출 제한(KbToolService)보다 길게 둔다 */
export const KB_MCP_TOOL_SEC = 20;
