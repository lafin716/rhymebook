/**
 * 원격 관리 채널 (ADR-116·117): 휴대폰·웹·PC 세션 창이 PC 메인 창의 예약·프롬프트·지식베이스를
 * 요청/응답(`sync.rpc`)으로 다루고, 변경은 `sync.event`로 방송받는다.
 * 여기서는 메서드 허용 목록·인자 형태·업로드 조립만 다룬다. 내용 검증(경로·URL·id)은 PC main IPC가 다시 한다.
 */
import { base64ToBytes, bytesToBase64 } from '../backup/crypto';
import { isKnowledgeId, isKnowledgePath, KNOWLEDGE_LIMITS, KNOWLEDGE_NAME_MAX } from '../knowledge';
import { SCHEDULE_LIMITS } from '../schedules';
import { isSkillRef } from '../skills';

export const SYNC_RPC_LIMITS = {
  /** 업로드 조각 원본 바이트 (base64는 약 4/3배) */
  chunkBytes: 512 * 1024,
  /** 파일 하나 최대 크기 */
  fileBytes: KNOWLEDGE_LIMITS.fileBytes,
  /** 피어당 동시에 조립 중인 업로드 수 */
  activeUploads: 3,
  /** 이 시간 동안 조각이 없으면 조립 중인 업로드를 버린다 */
  uploadIdleMs: 120_000,
  /** 피어당 rpc 허용량: windowMs 동안 최대 count개 (act와 별도) */
  windowMs: 10_000,
  count: 120,
  /** 오류 문구 최대 길이 */
  message: 500,
  /** 파일 이름 최대 길이 */
  fileName: 255,
} as const;

/** PC가 처리하는 메서드 (허용 목록) */
export const SYNC_RPC_METHODS = [
  'host.info',
  'schedules.list',
  'schedules.save',
  'schedules.remove',
  'schedules.toggle',
  'prompts.get',
  'prompts.set',
  'knowledge.list',
  'knowledge.create',
  'knowledge.rename',
  'knowledge.remove',
  'knowledge.tree',
  'knowledge.addLink',
  'knowledge.cloneGit',
  'knowledge.removeEntry',
  'knowledge.preview',
  'knowledge.cancel',
  'knowledge.setDescription',
  'knowledge.indexStates',
  'knowledge.reindex',
  'knowledge.cancelIndex',
  'knowledge.docs',
  'knowledge.getIndexSettings',
  'knowledge.setIndexSettings',
  'knowledge.sources',
  'knowledge.updateSource',
  'knowledge.source',
  'knowledge.upload',
] as const;
export type SyncRpcMethod = (typeof SYNC_RPC_METHODS)[number];

export function isSyncRpcMethod(v: unknown): v is SyncRpcMethod {
  return typeof v === 'string' && (SYNC_RPC_METHODS as readonly string[]).includes(v);
}

/** sync.rpc 실패 코드. 'failed'면 message에 보여줄 문구가 있다 */
export type SyncRpcError = 'invalid' | 'not-found' | 'rate-limit' | 'forbidden' | 'not-ready' | 'unsupported' | 'outdated' | 'failed';
export const SYNC_RPC_ERRORS: readonly SyncRpcError[] = ['invalid', 'not-found', 'rate-limit', 'forbidden', 'not-ready', 'unsupported', 'outdated', 'failed'];

/** 처리기가 특정 실패 코드를 돌려줄 때 던진다 (message는 보여줄 문구, 선택) */
export class SyncRpcFailure extends Error {
  constructor(readonly code: SyncRpcError, message = '') {
    super(message);
    this.name = 'SyncRpcFailure';
  }
}

/** PC → 전체 방송 주제 */
export const SYNC_EVENT_TOPICS = ['schedules', 'prompts', 'knowledge', 'knowledge.progress', 'knowledge.index'] as const;
export type SyncEventTopic = (typeof SYNC_EVENT_TOPICS)[number];

/** host.info 응답 */
export interface SyncHostInfo {
  /** PC의 IANA 시간대 (예약 시각 표시용) */
  timeZone: string;
  /** PC 지식베이스 기능이 있는가 */
  knowledge: boolean;
  /** 원격 삭제 허용 여부 (지식베이스·항목 삭제) */
  allowDelete: boolean;
}

/** knowledge.upload 인자를 이름으로 다루기 위한 형태 */
export interface SyncUploadChunk {
  kbId: string;
  uploadId: string;
  name: string;
  index: number;
  total: number;
  size: number;
  /** 조각 원본의 base64 */
  data: string;
  dest?: string;
}

type Check = (v: unknown) => boolean;
const opt = (c: Check): Check & { optional: true } => Object.assign((v: unknown) => v === undefined || v === null || c(v), { optional: true as const });
const str = (max: number): Check => (v) => typeof v === 'string' && v.length <= max;
const nonEmpty = (max: number): Check => (v) => typeof v === 'string' && v.length > 0 && v.length <= max;
/** sync.ts의 SYNC_ID_RE와 같다 (sync.ts가 이 모듈을 불러 순환을 피한다) */
const ID_RE = /^[\w-]{1,64}$/;
const syncId: Check = (v) => typeof v === 'string' && ID_RE.test(v);
const kb: Check = isKnowledgeId;
const kbPath: Check = isKnowledgePath;
const kbDest: Check = (v) => v === '' || isKnowledgePath(v);
const url = str(2048);
const plainObject: Check = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (min: number, max: number): Check => (v) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const maxB64 = Math.ceil(SYNC_RPC_LIMITS.chunkBytes / 3) * 4;
const b64: Check = (v) => typeof v === 'string' && v.length <= maxB64 && v.length % 4 === 0 && BASE64_RE.test(v);
const fileName: Check = (v) => typeof v === 'string' && isUploadName(v);

/** 파일 이름 하나 (경로 구분자·제어 문자·`.`/`..` 금지) */
export function isUploadName(v: string): boolean {
  // eslint-disable-next-line no-control-regex
  return v.length > 0 && v.length <= SYNC_RPC_LIMITS.fileName && !/[/\\\u0000-\u001f]/.test(v) && v !== '.' && v !== '..';
}

const SPECS: Record<SyncRpcMethod, readonly Check[]> = {
  'host.info': [],
  'schedules.list': [],
  'schedules.save': [plainObject, syncId, opt(syncId), opt(isSkillRef)],
  'schedules.remove': [syncId],
  'schedules.toggle': [syncId],
  'prompts.get': [],
  // 키·길이 정리는 PC가 sanitizePromptOverrides로 한다. 여기서는 전체 크기만 막는다
  'prompts.set': [(v) => plainObject(v) && JSON.stringify(v).length <= 400_000],
  'knowledge.list': [],
  'knowledge.create': [nonEmpty(KNOWLEDGE_NAME_MAX * 2)],
  'knowledge.rename': [kb, nonEmpty(KNOWLEDGE_NAME_MAX * 2)],
  'knowledge.remove': [kb],
  'knowledge.tree': [kb, opt(kbDest)],
  'knowledge.addLink': [kb, url],
  'knowledge.cloneGit': [kb, url],
  'knowledge.removeEntry': [kb, kbPath],
  'knowledge.preview': [kb, kbPath],
  'knowledge.cancel': [],
  'knowledge.setDescription': [kb, str(500)],
  'knowledge.indexStates': [opt((v) => Array.isArray(v) && v.length <= 500 && v.every(isKnowledgeId))],
  'knowledge.reindex': [kb, opt((v) => plainObject(v) && ((v as { full?: unknown }).full === undefined || typeof (v as { full?: unknown }).full === 'boolean'))],
  'knowledge.cancelIndex': [kb],
  'knowledge.docs': [kb, opt(str(200))],
  'knowledge.getIndexSettings': [kb],
  'knowledge.setIndexSettings': [kb, (v) => plainObject(v) && JSON.stringify(v).length <= 4000],
  'knowledge.sources': [kb],
  'knowledge.updateSource': [kb, (v) => typeof v === 'string' && /^[a-z0-9]{6,40}$/.test(v)],
  'knowledge.source': [kb, (v) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\\/]/.test(v) && v !== '.' && v !== '..'],
  // kbId, uploadId, name, index, total, size, data, dest?
  'knowledge.upload': [
    kb,
    syncId,
    fileName,
    int(0, Math.ceil(SYNC_RPC_LIMITS.fileBytes / SYNC_RPC_LIMITS.chunkBytes)),
    int(1, Math.max(1, Math.ceil(SYNC_RPC_LIMITS.fileBytes / SYNC_RPC_LIMITS.chunkBytes))),
    int(0, SYNC_RPC_LIMITS.fileBytes),
    b64,
    opt(kbDest),
  ],
};

/** schedules.save 첫 인자의 대략적 크기 확인 (내용은 PC의 validateScheduleInput이 본다) */
function scheduleInputShape(v: unknown): boolean {
  if (!plainObject(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.title === 'string' && o.title.length <= SCHEDULE_LIMITS.title * 2 &&
    typeof o.prompt === 'string' && o.prompt.length <= SCHEDULE_LIMITS.prompt * 2 &&
    typeof o.runAt === 'string' && o.runAt.length <= 64 &&
    typeof o.repeat === 'string' && o.repeat.length <= 16 &&
    (o.skill === undefined || (typeof o.skill === 'string' && o.skill.length <= 64))
  );
}

/** 인자 형태 검사. 맞으면 (끝의 빠진 선택 인자를 undefined로 채운) 인자 배열, 아니면 null */
export function validateRpcArgs(method: unknown, args: unknown): unknown[] | null {
  if (!isSyncRpcMethod(method) || !Array.isArray(args)) return null;
  const spec = SPECS[method];
  if (args.length > spec.length) return null;
  const out: unknown[] = [];
  for (let i = 0; i < spec.length; i++) {
    const check = spec[i]!;
    const v = args[i];
    if (v === undefined && !('optional' in check)) return null;
    if (!check(v)) return null;
    out.push(v === null ? undefined : v);
  }
  if (method === 'schedules.save' && !scheduleInputShape(out[0])) return null;
  // schedules.save의 skill은 null(스킬 지우기)과 undefined(그대로)를 구분해야 한다
  if (method === 'schedules.save' && args[3] === null) out[3] = null;
  if (method === 'knowledge.upload' && !validUploadChunk(out)) return null;
  return out;
}

function validUploadChunk(a: unknown[]): boolean {
  const [, , , index, total, size, data] = a as [string, string, string, number, number, number, string];
  if (index >= total) return false;
  if (Math.ceil(size / SYNC_RPC_LIMITS.chunkBytes) !== Math.max(1, total) && !(size === 0 && total === 1)) return false;
  const expected = index === total - 1 ? size - index * SYNC_RPC_LIMITS.chunkBytes : SYNC_RPC_LIMITS.chunkBytes;
  return base64Length(data) === expected;
}

/** base64 문자열이 담은 바이트 수 */
export function base64Length(s: string): number {
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

export function uploadChunkFromArgs(a: unknown[]): SyncUploadChunk {
  const [kbId, uploadId, name, index, total, size, data, dest] = a as [string, string, string, number, number, number, string, string | undefined];
  return { kbId, uploadId, name, index, total, size, data, ...(dest ? { dest } : {}) };
}

export function uploadChunkArgs(c: SyncUploadChunk): unknown[] {
  return [c.kbId, c.uploadId, c.name, c.index, c.total, c.size, c.data, ...(c.dest ? [c.dest] : [])];
}

/** base64 → 바이트. 형식이 틀리면 null */
function decodeChunk(s: string): Uint8Array | null {
  if (s.length % 4 !== 0 || !BASE64_RE.test(s)) return null;
  try {
    return base64ToBytes(s);
  } catch {
    return null;
  }
}

export interface AssembledUpload {
  kbId: string;
  name: string;
  data: Uint8Array;
  dest?: string;
}

export type UploadPush =
  | { ok: true; done: false; received: number }
  | { ok: true; done: true; file: AssembledUpload }
  | { ok: false; error: 'invalid' | 'busy' };

/**
 * 피어 하나의 조각 업로드 조립기. 조각은 0부터 순서대로 와야 하고, 첫 조각의 kbId·이름·크기·조각 수가 끝까지 같아야 한다.
 * 어긋나면 그 업로드를 버리고 'invalid'. 동시 업로드가 한도를 넘으면 'busy'.
 */
export function createUploadAssembler(opts: { now?: () => number; maxActive?: number; idleMs?: number } = {}) {
  const now = opts.now ?? (() => Date.now());
  const maxActive = opts.maxActive ?? SYNC_RPC_LIMITS.activeUploads;
  const idleMs = opts.idleMs ?? SYNC_RPC_LIMITS.uploadIdleMs;
  const active = new Map<string, { chunk: SyncUploadChunk; parts: Uint8Array[]; got: number; at: number }>();

  const sweep = () => {
    const t = now();
    for (const [id, u] of active) if (t - u.at > idleMs) active.delete(id);
  };

  return {
    push(c: SyncUploadChunk): UploadPush {
      sweep();
      const bytes = decodeChunk(c.data);
      if (!bytes) {
        active.delete(c.uploadId);
        return { ok: false, error: 'invalid' };
      }
      let u = active.get(c.uploadId);
      if (c.index === 0) {
        if (u) active.delete(c.uploadId);
        if (active.size >= maxActive) return { ok: false, error: 'busy' };
        u = { chunk: c, parts: [], got: 0, at: now() };
        active.set(c.uploadId, u);
      }
      if (
        !u ||
        u.parts.length !== c.index ||
        u.chunk.kbId !== c.kbId ||
        u.chunk.name !== c.name ||
        u.chunk.size !== c.size ||
        u.chunk.total !== c.total ||
        (u.chunk.dest ?? '') !== (c.dest ?? '') ||
        u.got + bytes.length > c.size
      ) {
        active.delete(c.uploadId);
        return { ok: false, error: 'invalid' };
      }
      u.parts.push(bytes);
      u.got += bytes.length;
      u.at = now();
      if (c.index < c.total - 1) return { ok: true, done: false, received: u.got };
      active.delete(c.uploadId);
      if (u.got !== c.size) return { ok: false, error: 'invalid' };
      const data = new Uint8Array(c.size);
      let off = 0;
      for (const p of u.parts) {
        data.set(p, off);
        off += p.length;
      }
      return { ok: true, done: true, file: { kbId: c.kbId, name: c.name, data, ...(c.dest ? { dest: c.dest } : {}) } };
    },
    /** 진행 중인 업로드 수 */
    get size() {
      sweep();
      return active.size;
    },
    clear() {
      active.clear();
    },
  };
}

/** 파일을 조각으로 나눈다 (클라이언트용). 빈 파일도 조각 하나 */
export function splitUpload(kbId: string, uploadId: string, name: string, data: Uint8Array, dest?: string): SyncUploadChunk[] {
  const size = data.length;
  const total = Math.max(1, Math.ceil(size / SYNC_RPC_LIMITS.chunkBytes));
  const out: SyncUploadChunk[] = [];
  for (let index = 0; index < total; index++) {
    const part = data.subarray(index * SYNC_RPC_LIMITS.chunkBytes, Math.min(size, (index + 1) * SYNC_RPC_LIMITS.chunkBytes));
    out.push({ kbId, uploadId, name, index, total, size, data: bytesToBase64(part), ...(dest ? { dest } : {}) });
  }
  return out;
}
