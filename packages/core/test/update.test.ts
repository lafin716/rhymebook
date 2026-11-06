import { describe, expect, it, vi } from 'vitest';
import {
  candidateFromGithubRelease,
  classifyUpdateError,
  compareVersions,
  createUpdateController,
  isNewerVersion,
  isStableVersion,
  isTrustedReleaseUrl,
  releaseNotesToText,
  releasePageUrl,
  resolveUpdateMode,
  shouldShowUpdateNotice,
  type UpdateBackend,
  type UpdateCandidate,
  type UpdateProgress,
  type UpdateState,
  type UpdateTimers,
} from '../src/update';

/** 수동으로 돌리는 가짜 타이머 */
function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  const timers: UpdateTimers = {
    setTimeout(fn, ms) {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
  };
  return {
    timers,
    pending,
    /** 예약된 것 하나를 실행 (가장 최근) */
    fire() {
      const [id, t] = [...pending.entries()].at(-1)!;
      pending.delete(id);
      t.fn();
      return t.ms;
    },
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const NEXT: UpdateCandidate = { version: '0.55.0', releaseName: 'v0.55.0', releaseNotes: '<p>새 기능</p>' };

function setup(backend: Partial<UpdateBackend> = {}, mode: 'auto' | 'manual' | 'disabled' = 'auto') {
  const t = fakeTimers();
  const changes: UpdateState[] = [];
  let clock = 1_000_000;
  const c = createUpdateController({
    currentVersion: '0.54.0',
    mode,
    backend: { check: async () => null, ...backend },
    releaseUrl: (v) => releasePageUrl('lafin716', 'octobooks', v),
    onChange: (s) => changes.push(s),
    timers: t.timers,
    now: () => clock,
  });
  return { c, t, changes, advance: (ms: number) => (clock += ms) };
}

describe('createUpdateController', () => {
  it('최신이면 up-to-date, 알림 대상 아님', async () => {
    const { c } = setup();
    const s = await c.check();
    expect(s.status).toBe('up-to-date');
    expect(s.lastCheckedAt).toBe(1_000_000);
    expect(shouldShowUpdateNotice(s)).toBe(false);
  });

  it('새 버전을 찾으면 available + 글자 노트 + 릴리스 주소', async () => {
    const { c } = setup({ check: async () => NEXT });
    const s = await c.check();
    expect(s).toMatchObject({
      status: 'available',
      latestVersion: '0.55.0',
      releaseNotes: '새 기능',
      releaseUrl: 'https://github.com/lafin716/octobooks/releases/tag/v0.55.0',
    });
    expect(shouldShowUpdateNotice(s)).toBe(true);
    expect(shouldShowUpdateNotice(s, '0.55.0')).toBe(false);
  });

  it('같은·낮은 버전은 무시 (다운그레이드 방지)', async () => {
    const { c } = setup({ check: async () => ({ version: '0.53.9' }) });
    expect((await c.check()).status).toBe('up-to-date');
  });

  it('동시에 확인해도 백엔드는 한 번만', async () => {
    const d = deferred<UpdateCandidate | null>();
    const check = vi.fn(() => d.promise);
    const { c } = setup({ check });
    const a = c.check();
    const b = c.check({ manual: true });
    d.resolve(NEXT);
    expect(await a).toBe(await b);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('수동 확인 연타는 쿨다운 동안 무시', async () => {
    const check = vi.fn(async () => null);
    const { c, advance } = setup({ check });
    await c.check({ manual: true });
    await c.check({ manual: true });
    expect(check).toHaveBeenCalledTimes(1);
    advance(6000);
    await c.check({ manual: true });
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('10초 뒤 첫 확인, 이후 6시간 주기, start 두 번은 한 번만 예약', async () => {
    const check = vi.fn(async () => null);
    const { c, t } = setup({ check });
    c.start();
    c.start();
    expect(t.pending.size).toBe(1);
    expect(t.fire()).toBe(10_000);
    await vi.waitFor(() => expect(c.getState().status).toBe('up-to-date'));
    expect([...t.pending.values()].map((p) => p.ms)).toEqual([6 * 60 * 60 * 1000]);
    c.stop();
    expect(t.pending.size).toBe(0);
  });

  it('자동 확인 실패: 오류는 알림 카드에 안 띄우고 30분 뒤 재시도', async () => {
    const { c, t } = setup({ check: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND github.com')) });
    c.start();
    t.fire();
    await vi.waitFor(() => expect(c.getState().status).toBe('error'));
    const s = c.getState();
    expect(s.error).toMatchObject({ kind: 'network', during: 'check', manual: false });
    expect(shouldShowUpdateNotice(s)).toBe(false);
    expect([...t.pending.values()].map((p) => p.ms)).toEqual([30 * 60 * 1000]);
  });

  it('이미 찾은 새 버전은 자동 확인 실패에도 유지', async () => {
    let fail = false;
    const { c } = setup({ check: async () => (fail ? Promise.reject(new Error('timeout')) : NEXT) });
    await c.check();
    fail = true;
    const s = await c.check();
    expect(s.status).toBe('available');
    expect(s.latestVersion).toBe('0.55.0');
  });

  it('다운로드: 진행률 → downloaded, 중복 요청은 같은 다운로드', async () => {
    const d = deferred<void>();
    let report!: (p: UpdateProgress) => void;
    const download = vi.fn((on: (p: UpdateProgress) => void) => {
      report = on;
      return d.promise;
    });
    const { c } = setup({ check: async () => NEXT, download });
    await c.check();
    const a = c.download();
    const b = c.download();
    expect(download).toHaveBeenCalledTimes(1);
    expect(c.getState()).toMatchObject({ status: 'downloading', percent: 0 });
    report({ percent: 42.37, transferred: 42, total: 100, bytesPerSecond: 10 });
    expect(c.getState()).toMatchObject({ percent: 42.4, transferred: 42, total: 100 });
    report({ percent: 140 });
    expect(c.getState().percent).toBe(100);
    d.resolve();
    expect(await a).toBe(await b);
    expect(c.getState()).toMatchObject({ status: 'downloaded', percent: 100 });
    // 받은 뒤에는 다시 확인·다운로드하지 않는다
    expect((await c.check()).status).toBe('downloaded');
    await c.download();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('available 전에는 다운로드하지 않는다', async () => {
    const download = vi.fn(async () => {});
    const { c } = setup({ download });
    await c.download();
    expect(download).not.toHaveBeenCalled();
    expect(c.getState().status).toBe('idle');
  });

  it('다운로드 실패 → error(download) 알림 + 재시도 가능', async () => {
    let n = 0;
    const download = vi.fn(async () => {
      if (++n === 1) throw new Error('sha512 checksum mismatch');
    });
    const { c } = setup({ check: async () => NEXT, download });
    await c.check();
    const s = await c.download();
    expect(s.status).toBe('error');
    expect(s.error).toMatchObject({ kind: 'integrity', during: 'download' });
    expect(s.latestVersion).toBe('0.55.0');
    expect(shouldShowUpdateNotice(s)).toBe(true);
    expect((await c.download()).status).toBe('downloaded');
  });

  it('manual 모드는 다운로드·설치를 하지 않는다', async () => {
    const download = vi.fn(async () => {});
    const install = vi.fn();
    const { c } = setup({ check: async () => NEXT, download, install }, 'manual');
    await c.check();
    await c.download();
    expect(c.install()).toBe(false);
    expect(download).not.toHaveBeenCalled();
    expect(install).not.toHaveBeenCalled();
  });

  it('disabled 모드는 확인도 예약도 하지 않는다', async () => {
    const check = vi.fn(async () => NEXT);
    const { c, t } = setup({ check }, 'disabled');
    c.start();
    await c.check({ manual: true });
    expect(t.pending.size).toBe(0);
    expect(check).not.toHaveBeenCalled();
  });

  it('설치는 downloaded에서만, 실패하면 downloaded로 되돌림', async () => {
    let throwOnInstall = true;
    const install = vi.fn(() => {
      if (throwOnInstall) throw new Error('EACCES');
    });
    const { c } = setup({ check: async () => NEXT, download: async () => {}, install });
    expect(c.install()).toBe(false);
    await c.check();
    await c.download();
    expect(c.install()).toBe(false);
    expect(c.getState().status).toBe('downloaded');
    expect(c.getState().error?.kind).toBe('disk');
    throwOnInstall = false;
    expect(c.install()).toBe(true);
    expect(c.getState().status).toBe('installing');
    expect((await c.check()).status).toBe('installing');
  });

  it('받은 뒤 자동 확인 타이머가 돌아도 주기 확인은 계속 예약된다', async () => {
    const check = vi.fn(async () => NEXT);
    const { c, t } = setup({ check, download: async () => {} });
    await c.check();
    await c.download();
    t.pending.clear();
    c.start();
    t.fire();
    await Promise.resolve();
    expect(c.getState().status).toBe('downloaded');
    expect(check).toHaveBeenCalledTimes(1);
    expect([...t.pending.values()].map((p) => p.ms)).toContain(6 * 60 * 60 * 1000);
  });

  it('새 버전 알림 중 수동 확인 실패: available 유지 + 확인 오류 표시', async () => {
    let fail = false;
    const { c, advance } = setup({ check: async () => (fail ? Promise.reject(new Error('getaddrinfo ENOTFOUND')) : NEXT) });
    await c.check();
    fail = true;
    advance(10_000);
    const s = await c.check({ manual: true });
    expect(s.status).toBe('available');
    expect(s.latestVersion).toBe('0.55.0');
    expect(s.error).toMatchObject({ kind: 'network', during: 'check' });
    expect(shouldShowUpdateNotice(s)).toBe(true);
  });

  it('다운로드 오류 중 확인 실패는 다운로드 오류를 유지', async () => {
    let failCheck = false;
    const { c } = setup({
      check: async () => (failCheck ? Promise.reject(new Error('timeout')) : NEXT),
      download: async () => {
        throw new Error('sha512 checksum mismatch');
      },
    });
    await c.check();
    await c.download();
    failCheck = true;
    const s = await c.check();
    expect(s.status).toBe('error');
    expect(s.error?.during).toBe('download');
    expect(s.latestVersion).toBe('0.55.0');
  });

  it('설치가 시작되지 않으면 installStalled로 downloaded + 오류', async () => {
    const { c } = setup({ check: async () => NEXT, download: async () => {}, install: () => {} });
    await c.check();
    await c.download();
    expect(c.install()).toBe(true);
    c.installStalled();
    expect(c.getState().status).toBe('downloaded');
    expect(c.getState().error?.during).toBe('install');
    c.installStalled();
    expect(c.getState().status).toBe('downloaded');
  });
});

describe('버전', () => {
  it('semver 비교', () => {
    expect(compareVersions('0.55.0', '0.54.0')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
  it('isNewerVersion / isStableVersion', () => {
    expect(isNewerVersion('0.55.0', '0.54.0')).toBe(true);
    expect(isNewerVersion('0.54.0', '0.54.0')).toBe(false);
    expect(isNewerVersion('garbage', '0.54.0')).toBe(false);
    expect(isStableVersion('0.55.0')).toBe(true);
    expect(isStableVersion('0.55.0-beta.1')).toBe(false);
  });
});

describe('releaseNotesToText', () => {
  it('HTML → 글자 (목록·문단·엔티티, 스크립트 제거)', () => {
    const html =
      '<h2>What&#39;s Changed</h2><ul><li>자동 업데이트 &amp; 알림</li><li><a href="x">링크</a></li></ul>' +
      '<script>alert(1)</script><p>끝&lt;3</p><img src=x onerror=alert(1)>';
    expect(releaseNotesToText(html)).toBe("What's Changed\n\n• 자동 업데이트 & 알림\n• 링크\n\n끝<3");
  });
  it('버전별 배열, 그 외 타입', () => {
    expect(releaseNotesToText([{ version: '1', note: 'a' }, { version: '2', note: null }, { note: 'b' }])).toBe('a\n\nb');
    expect(releaseNotesToText(null)).toBe('');
    expect(releaseNotesToText(42)).toBe('');
  });
  it('마크다운은 그대로, 너무 길면 자른다', () => {
    expect(releaseNotesToText('## 변경\r\n- 하나')).toBe('## 변경\n- 하나');
    expect(releaseNotesToText('x'.repeat(5000))).toHaveLength(4001);
  });
  it('잘못된 숫자 엔티티는 남긴다', () => {
    expect(releaseNotesToText('&#xD800;&#0;&#65;')).toBe('&#xD800;&#0;A');
  });
});

describe('classifyUpdateError', () => {
  it.each([
    ['net::ERR_INTERNET_DISCONNECTED', 'network'],
    ['HttpError: 403 Forbidden rate limit exceeded', 'rate-limit'],
    ['Cannot find latest-mac.yml in the latest release artifacts', 'not-found'],
    ['sha512 checksum mismatch, expected abc', 'integrity'],
    ['Could not get code signature for running application', 'signature'],
    ['ENOSPC: no space left on device', 'disk'],
    ['something odd', 'unknown'],
  ])('%s → %s', (msg, kind) => {
    expect(classifyUpdateError(msg)).toBe(kind);
  });
});

describe('resolveUpdateMode', () => {
  it('플랫폼별', () => {
    expect(resolveUpdateMode({ packaged: false, platform: 'win32' })).toEqual({ mode: 'disabled', reason: 'dev' });
    expect(resolveUpdateMode({ packaged: true, platform: 'win32', disabled: true })).toEqual({ mode: 'disabled', reason: 'env-disabled' });
    expect(resolveUpdateMode({ packaged: true, platform: 'win32' })).toEqual({ mode: 'auto' });
    expect(resolveUpdateMode({ packaged: true, platform: 'win32', portable: true }).mode).toBe('manual');
    expect(resolveUpdateMode({ packaged: true, platform: 'darwin', macSigned: true })).toEqual({ mode: 'auto' });
    expect(resolveUpdateMode({ packaged: true, platform: 'darwin' })).toEqual({ mode: 'manual', reason: 'mac-unsigned' });
    expect(resolveUpdateMode({ packaged: true, platform: 'linux', appImage: true })).toEqual({ mode: 'auto' });
    expect(resolveUpdateMode({ packaged: true, platform: 'linux' })).toEqual({ mode: 'manual', reason: 'linux-package' });
  });
});

describe('릴리스 주소·GitHub 응답', () => {
  it('신뢰할 수 있는 주소만', () => {
    expect(isTrustedReleaseUrl(releasePageUrl('lafin716', 'octobooks', 'v0.55.0'), 'lafin716', 'octobooks')).toBe(true);
    expect(isTrustedReleaseUrl('https://github.com/evil/octobooks/releases/tag/v1', 'lafin716', 'octobooks')).toBe(false);
    expect(isTrustedReleaseUrl('http://github.com/lafin716/octobooks/releases/', 'lafin716', 'octobooks')).toBe(false);
    expect(isTrustedReleaseUrl('https://github.com.evil.io/lafin716/octobooks/releases/', 'lafin716', 'octobooks')).toBe(false);
    expect(isTrustedReleaseUrl('https://x@github.com/lafin716/octobooks/releases/', 'lafin716', 'octobooks')).toBe(false);
    expect(isTrustedReleaseUrl('not a url', 'lafin716', 'octobooks')).toBe(false);
  });
  it('candidateFromGithubRelease: 정식·공개 릴리스만', () => {
    expect(candidateFromGithubRelease({ tag_name: 'v0.55.0', name: 'v0.55.0', body: '- a', published_at: '2026-11-06' })).toEqual({
      version: '0.55.0',
      releaseName: 'v0.55.0',
      releaseNotes: '- a',
      releaseDate: '2026-11-06',
    });
    expect(candidateFromGithubRelease({ tag_name: 'v0.55.0', draft: true })).toBeNull();
    expect(candidateFromGithubRelease({ tag_name: 'v0.55.0', prerelease: true })).toBeNull();
    expect(candidateFromGithubRelease({ tag_name: 'v0.55.0-beta.1' })).toBeNull();
    expect(candidateFromGithubRelease('x')).toBeNull();
  });
});
