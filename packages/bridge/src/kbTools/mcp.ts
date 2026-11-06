import { KB_TOOL_NAMES } from '@branch/core';
import { KB_TOOL_DEFINITIONS } from './config';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export interface McpHandlerOptions {
  serverName: string;
  serverVersion: string;
  callTool: (name: string, args: unknown) => Promise<McpCallResult>;
}

/** stdio MCP 서버의 JSON-RPC 처리. 알림(id 없음)에는 응답하지 않는다 */
export function createMcpHandler(opts: McpHandlerOptions): (msg: JsonRpcRequest) => Promise<JsonRpcResponse | undefined> {
  return async (msg) => {
    const isNotification = msg.id === undefined;
    const id = msg.id ?? null;
    const ok = (result: unknown): JsonRpcResponse | undefined => (isNotification ? undefined : { jsonrpc: '2.0', id, result });
    const fail = (code: number, message: string): JsonRpcResponse | undefined =>
      isNotification ? undefined : { jsonrpc: '2.0', id, error: { code, message } };

    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: opts.serverName, version: opts.serverVersion },
        });
      case 'notifications/initialized':
        return undefined;
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: KB_TOOL_DEFINITIONS });
      case 'tools/call': {
        const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof p.name !== 'string' || !(KB_TOOL_NAMES as readonly string[]).includes(p.name)) {
          return fail(-32602, 'unknown tool');
        }
        const r = await opts.callTool(p.name, p.arguments ?? {});
        return ok({ content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) });
      }
      default:
        return fail(-32601, `method not found: ${String(msg.method)}`);
    }
  };
}

/** 줄 단위 JSON-RPC 입력 처리. 잘못된 JSON은 -32700 응답 */
export function parseLine(line: string): JsonRpcRequest | { parseError: true } | undefined {
  const t = line.trim();
  if (!t) return undefined;
  try {
    const v = JSON.parse(t) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { parseError: true };
    return v as JsonRpcRequest;
  } catch {
    return { parseError: true };
  }
}
