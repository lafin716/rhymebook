import { execFile } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExcludeMatcher } from '@branch/core';
import {
  CODEBASE_LIMITS,
  type CodebaseTarget,
  isExcludedEntry,
  isSkippedRel,
  matcherFor,
  relPathOf,
  throwIfAborted,
} from './target';

const execFileP = promisify(execFile);

/**
 * git ls-files 인자. 신뢰할 수 없는 저장소의 설정(fsmonitor·hooksPath)이 명령을 실행하지 못하게 앞에 고정한다.
 * 셸을 쓰지 않고 execFile에 배열로 넘긴다.
 */
export function gitListArgs(): string[] {
  return ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', 'ls-files', '-co', '--exclude-standard', '-z'];
}

/** git 실행 환경: 시스템 설정 무시, 자격 증명 프롬프트 끔 */
export function gitListEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

export interface ListOptions {
  signal?: AbortSignal;
  /** 목록 상한 (기본 CODEBASE_LIMITS.maxFiles) */
  maxFiles?: number;
  /** 이 폴더 아래만 (상대 경로) */
  pathPrefix?: string;
}

function underPrefix(rel: string, prefix: string): boolean {
  return !prefix || rel === prefix || rel.startsWith(prefix + '/');
}

/** git이 추적·비무시 파일을 나열 (고정 인자, shell 없음). 실패하면 undefined */
async function gitListing(root: string, signal: AbortSignal | undefined): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileP('git', gitListArgs(), {
      cwd: root,
      env: gitListEnv(),
      maxBuffer: CODEBASE_LIMITS.gitMaxBuffer,
      timeout: CODEBASE_LIMITS.gitTimeoutMs,
      signal,
    });
    return stdout.split('\0').filter(Boolean);
  } catch (e) {
    if (signal?.aborted) throw e;
    return undefined;
  }
}

/** 폴더 직접 걷기: 숨김·심볼릭 링크·제외 패턴은 내려가지 않는다 */
async function walkListing(
  rootReal: string,
  start: string,
  matcher: ExcludeMatcher,
  limit: number,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [start];
  while (queue.length) {
    throwIfAborted(signal);
    const dirRel = queue.shift()!;
    const abs = dirRel ? path.join(rootReal, ...dirRel.split('/')) : rootReal;
    const dirents = await readdir(abs, { withFileTypes: true }).catch(() => []);
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      const rel = dirRel ? `${dirRel}/${d.name}` : d.name;
      if (d.isSymbolicLink()) continue;
      if (d.isDirectory()) {
        if (!isExcludedEntry(rel, true, matcher)) queue.push(rel);
      } else if (d.isFile()) {
        if (!isSkippedRel(rel, matcher)) {
          out.push(rel);
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

/**
 * 코드베이스 파일 목록 (정렬, 제외 적용, 상대 경로).
 * root에 .git이 있으면 git ls-files (추적 + 무시되지 않은 새 파일), 없으면 폴더 걷기.
 * 이 함수는 색인을 쓰지 않는다.
 */
export async function listCodebaseFiles(target: CodebaseTarget, opts: ListOptions = {}): Promise<string[]> {
  throwIfAborted(opts.signal);
  const limit = opts.maxFiles ?? CODEBASE_LIMITS.maxFiles;
  const prefix = relPathOf(opts.pathPrefix) ?? '';
  const matcher = matcherFor(target);
  const rootReal = await realpath(target.root).catch(() => undefined);
  if (!rootReal) return [];
  if (prefix && isExcludedEntry(prefix, true, matcher)) return [];

  let files: string[] | undefined;
  const gitDir = await lstat(path.join(rootReal, '.git')).catch(() => undefined);
  if (gitDir) {
    files = await gitListing(rootReal, opts.signal);
    if (files) {
      files = files
        .map((f) => relPathOf(f))
        .filter((f): f is string => f !== undefined && f !== '' && underPrefix(f, prefix) && !isSkippedRel(f, matcher))
        .sort();
    }
  }
  if (!files) {
    files = await walkListing(rootReal, prefix, matcher, limit, opts.signal);
    files.sort();
  }
  return files.slice(0, limit);
}

/**
 * 이름 패턴으로 파일 찾기. 패턴에 '/'가 없으면 파일 이름에, 있으면 상대 경로에 맞춘다.
 * `*`는 '/'를 넘지 않고 `**`는 넘는다. 와일드카드가 없으면 부분 문자열(대소문자 무시).
 */
export function patternToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      re += '.*';
      i++;
      if (pattern[i + 1] === '/') {
        re += '/';
        i++;
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(pattern.includes('*') || pattern.includes('?') ? `^${re}$` : re, 'i');
}

export async function findFiles(target: CodebaseTarget, pattern: string, opts: ListOptions & { limit?: number } = {}): Promise<string[]> {
  const re = patternToRegExp(pattern.trim());
  const files = await listCodebaseFiles(target, opts);
  const hasSlash = pattern.includes('/');
  const limit = opts.limit ?? 50;
  const out: string[] = [];
  for (const f of files) {
    throwIfAborted(opts.signal);
    const subject = hasSlash ? f : f.slice(f.lastIndexOf('/') + 1);
    if (re.test(subject)) {
      out.push(f);
      if (out.length >= limit) break;
    }
  }
  return out;
}
