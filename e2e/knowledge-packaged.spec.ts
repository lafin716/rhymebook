import { _electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

/**
 * ADR-113 패키지 앱 Smoke (완료 기준 11개 시나리오). 실제 worker·node:sqlite·pdfjs·IPC를 쓴다.
 * LLM만 renderer 경로에서 모의한다. 패키징 후 `RHYMEBOOK_PACKAGED=1 pnpm exec playwright test e2e/knowledge-packaged.spec.ts --project=desktop`.
 * macOS 기본 경로: apps/desktop/release/mac-arm64/OctoBooks.app (RHYMEBOOK_EXE로 바꿀 수 있다).
 */

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const KB_NAME = '쿠버네티스 문서';

const NETWORKING_MD = `# Cluster Networking

Kubernetes networking gives every Pod its own IP address.

## Pod IP address management (IPAM)

The CNI plugin is responsible for Pod networking. Its IPAM module assigns each Pod an IP address
from the Pod CIDR range allocated to the node. The kubelet calls the CNI plugin when a Pod sandbox is created.

## Services

A Service gets a stable virtual ClusterIP that kube-proxy routes to the Pod endpoints.
`;

/** 텍스트 한 줄짜리 최소 PDF (xref 오프셋을 계산한다) */
function makePdf(text: string): Buffer {
  const stream = `BT /F1 10 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

interface Captured {
  systems: string[];
}

async function mockLlm(page: Page, cap: Captured) {
  await page.route('**/v1/models**', (route) => route.fulfill({ contentType: 'application/json', body: '{"data":[]}', headers: CORS }));
  await page.route('**/v1/messages', async (route) => {
    const body = route.request().postDataJSON() as { system?: string | { text: string }[]; messages?: { content: unknown }[] };
    const system = typeof body.system === 'string' ? body.system : (body.system ?? []).map((b) => b.text).join('\n');
    const lastUser = JSON.stringify(body.messages?.at(-1)?.content ?? '');
    let text = '쿠버네티스 네트워킹';
    if (system.includes('<documents>')) {
      cap.systems.push(system);
      text = 'CNI 플러그인의 IPAM이 Pod IP를 할당합니다 [1].';
    } else if (lastUser.includes('안녕') || !/주제|제목|요약|title|summar/i.test(system.slice(0, 200))) {
      cap.systems.push(system);
      text = '일반 답변입니다.';
    }
    const events = [
      { type: 'message_start', message: {} },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ];
    await route.fulfill({ contentType: 'text/event-stream', headers: CORS, body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') });
  });
}

async function launch(userData: string) {
  const exe = process.env.RHYMEBOOK_EXE ?? 'apps/desktop/release/mac-arm64/OctoBooks.app/Contents/MacOS/OctoBooks';
  const app = await _electron.launch({ executablePath: path.resolve(exe), env: { ...process.env, BRANCH_USER_DATA: userData } });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { app, page, errors };
}

async function stubPicker(app: ElectronApplication, files: string[]) {
  await app.evaluate(({ dialog }, list) => {
    (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({ canceled: false, filePaths: list });
  }, files);
}

type Kn = {
  list(): Promise<{ id: string; name: string }[]>;
  indexStates(ids?: string[]): Promise<{ status: string; docCount: number; chunkCount: number; failedDocs: number; error?: string }[]>;
  docs(id: string): Promise<{ docId: string; path: string; kind: string; chunkCount: number; status: string }[]>;
  retrieve(req: unknown): Promise<{ evidence: { path: string; text: string; page?: number; chunkId: string; symbol?: string }[] }>;
};

const kbIdOf = (page: Page) =>
  page.evaluate(async (name) => {
    const kn = (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge;
    return (await kn.list()).find((b) => b.name === name)!.id;
  }, KB_NAME);

const stateOf = (page: Page, id: string) =>
  page.evaluate(async (kid) => {
    const kn = (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge;
    return (await kn.indexStates([kid]))[0]!;
  }, id);

const retrieve = (page: Page, id: string, words: string[]) =>
  page.evaluate(
    async ({ kid, ws }) => {
      const kn = (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge;
      const q = ws.join(' ');
      const plan = { original: q, rewritten: q, keywords: ws, contextTerms: [], vectorText: q, keywordQuery: ws, contextual: false };
      const settings = { enabled: true, candidates: 30, rrfK: 60, keywordWeight: 1, vectorWeight: 1, rerank: true, topK: 6, maxContextChars: 9000, expandParent: true, minScore: 0 };
      return (await kn.retrieve({ kbIds: [kid], plan, settings })).evidence;
    },
    { kid: id, ws: words },
  );

async function waitReady(page: Page, id: string) {
  await expect
    .poll(async () => (await stateOf(page, id)).status, { timeout: 60_000, intervals: [300, 500, 1000] })
    .toBe('ready');
}

async function useApiProvider(page: Page) {
  const onboarding = page.getByRole('dialog', { name: '시작하기' });
  if (await onboarding.isVisible().catch(() => false)) {
    await onboarding.getByRole('button', { name: /^API 키/ }).click();
  } else {
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '설정', exact: true }).click();
  }
  await page.getByLabel('Anthropic API 키').fill('sk-ant-e2e-ok');
  await page.getByLabel('Anthropic API 키').press('Enter');
  const settings = page.getByRole('dialog', { name: '설정', exact: true });
  if (await settings.isVisible().catch(() => false)) {
    await settings.getByRole('tab', { name: '일반' }).click();
    await settings.locator('select:has(option[value="anthropic-api"])').selectOption('anthropic-api');
  }
  await page.keyboard.press('Escape');
}

async function ask(main: ReturnType<Page['locator']>, q: string, expectText: string) {
  await main.getByLabel('메시지 입력').fill(q);
  await main.getByRole('button', { name: '보내기' }).click();
  await expect(main.getByText(expectText).last()).toBeVisible({ timeout: 30_000 });
}

test('패키지 앱: 지식베이스 RAG 완료 기준 11개 시나리오', async ({ browserName }, testInfo) => {
  test.skip(process.env.RHYMEBOOK_PACKAGED !== '1' || testInfo.project.name !== 'desktop' || browserName !== 'chromium', '패키징 후 RHYMEBOOK_PACKAGED=1로 실행');
  test.setTimeout(300_000);
  const root = await mkdtemp(path.join(os.tmpdir(), 'octobooks-kb-smoke-'));
  const userData = path.join(root, 'userData');
  const src = path.join(root, 'src');
  await mkdir(src, { recursive: true });
  const fixtures = path.resolve('packages/bridge/test/fixtures/rag/k8s');
  const files = [path.join(src, 'networking.md'), path.join(src, 'kube-proxy.pdf')];
  await writeFile(files[0]!, NETWORKING_MD);
  await writeFile(files[1]!, makePdf("pdfsentinel: kube-proxy maintains iptables rules for Service traffic on every node."));
  // ADR-115: 1,600자를 넘는 클래스는 멤버 단위로 나뉘어 `Class.method` 심볼이 붙는다 (정규식 폴백에서는 붙지 않음)
  const pad = Array.from({ length: 30 }, (_, i) => `  helper${i}(value: number): number {\n    return value * ${i + 2} + this.rows.size;\n  }`).join('\n');
  files.push(path.join(src, 'userRepository.ts'));
  await writeFile(
    files[files.length - 1]!,
    `export class UserRepository {\n  private rows = new Map<string, unknown>();\n${pad}\n  /** id로 사용자 한 명을 찾는다 */\n  findUserById(id: string) {\n    return this.rows.get(id);\n  }\n}\n`,
  );
  for (const f of await readdir(fixtures)) {
    await writeFile(path.join(src, f), await readFile(path.join(fixtures, f)));
    files.push(path.join(src, f));
  }
  const cap: Captured = { systems: [] };
  const log = (m: string) => console.log(`[smoke] ${m}`);

  // ── 1회차 실행 ──
  let { app, page, errors } = await launch(userData);
  let kbId = '';
  try {
    await mockLlm(page, cap);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
    await useApiProvider(page);
    await page.getByRole('button', { name: '새 학습 시작' }).click();
    const main = page.locator('[data-panel="main"]');

    // 1. 지식베이스 생성
    await main.locator('[data-knowledge-button]').click();
    const dialog = page.getByRole('dialog', { name: '지식베이스' });
    await dialog.getByRole('button', { name: '새 지식베이스' }).first().click();
    await dialog.getByLabel('새 지식베이스').fill(KB_NAME);
    await dialog.getByRole('button', { name: '만들기' }).click();
    await expect(dialog.getByRole('heading', { name: KB_NAME, level: 3 })).toBeVisible();
    kbId = await kbIdOf(page);
    log(`1 생성 OK kbId=${kbId}`);

    // 2. MD·PDF 등록 (네이티브 파일 대화상자만 대체)
    await stubPicker(app, files);
    await dialog.getByRole('button', { name: '파일 선택' }).click();
    await expect(dialog.getByText('networking.md').first()).toBeVisible({ timeout: 20_000 });
    log('2 등록 OK');

    // 3. 백그라운드 색인 (UI는 계속 반응)
    await waitReady(page, kbId);
    const st = await stateOf(page, kbId);
    const docs = await page.evaluate(async (kid) => (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge.docs(kid), kbId);
    log(`3 색인 OK ${JSON.stringify(st)} docs=${JSON.stringify(docs.map((d) => [d.path, d.kind, d.chunkCount, d.status]))}`);
    expect(st.docCount).toBe(5);
    expect(st.failedDocs).toBe(0);
    expect(docs.find((d) => d.kind === 'pdf')?.chunkCount ?? 0).toBeGreaterThan(0);
    const pdfHits = await retrieve(page, kbId, ['pdfsentinel']);
    log(`3 PDF 검색 ${JSON.stringify(pdfHits.map((h) => [h.path, h.page, h.text.slice(0, 80)]))}`);
    expect(pdfHits[0]?.path).toBe('kube-proxy.pdf');
    expect(pdfHits[0]?.page).toBe(1);
    const codeHits = await retrieve(page, kbId, ['findUserById']);
    log(`3 코드 심볼 검색 ${JSON.stringify(codeHits.map((h) => [h.path, h.symbol]))}`);
    expect(codeHits[0]?.symbol).toBe('UserRepository.findUserById');
    await page.screenshot({ path: testInfo.outputPath('kb-indexed.png') });

    // 4. 세션에 연결
    await dialog.getByRole('button', { name: '이 학습에 연결', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '연결 해제', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(main.locator('[data-knowledge-button][data-linked]')).toHaveCount(1);
    log('4 연결 OK');

    // 5·6. 질문 → 근거 검색 → 출처 칩 (문맥 질문 포함)
    await ask(main, '쿠버네티스 Pod 네트워킹은 어떻게 동작해?', 'IPAM이 Pod IP를 할당합니다');
    await ask(main, '그럼 IP는 누가 할당해?', 'IPAM이 Pod IP를 할당합니다');
    const lastSys = cap.systems.at(-1)!;
    expect(lastSys).toContain('<documents>');
    expect(lastSys).toContain('IPAM');
    const chips = main.locator('[data-citation]');
    await expect(chips.first()).toBeVisible();
    log(`5·6 답변·출처 OK chips=${await chips.count()}`);
    await chips.last().click();
    const viewer = page.getByRole('dialog', { name: '출처 보기' });
    await expect(viewer).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('kb-source-viewer.png') });
    await viewer.getByRole('button', { name: '닫기' }).first().click();

    // 7. 가지 만들기 (사이드바 + → 세션)
    const nav = page.getByRole('navigation', { name: '학습 세션' });
    await nav.locator('[data-tree-title]').first().click();
    await nav.getByRole('button', { name: '하위 항목 만들기' }).first().click({ force: true });
    await page.getByRole('menu', { name: '하위 항목 만들기' }).getByRole('menuitem', { name: '세션' }).click();
    await expect(page.locator('header').filter({ hasText: '새 학습' }).first()).toBeVisible();
    log('7 가지 OK');

    // 8. 가지가 부모 KB를 상속하고 검색한다
    // 사이드바에서 만든 세션은 메인이 아닌 가지 자리(팝업·분할·시트)에 열린다
    const branch = page.locator('[data-panel]:not([data-panel="main"])').filter({ has: page.locator('[data-knowledge-button]') }).first();
    await expect(branch.locator('[data-knowledge-button][data-inherited]')).toHaveCount(1);
    const before = cap.systems.length;
    await ask(branch, 'Service의 ClusterIP는 어디로 가?', 'IPAM이 Pod IP를 할당합니다');
    expect(cap.systems.length).toBeGreaterThan(before);
    expect(cap.systems.at(-1)).toContain('<documents>');
    await expect(branch.locator('[data-citation]').first()).toBeVisible();
    log('8 가지 상속 검색 OK');
    await page.keyboard.press('Escape');

    // 11(일부). KB 없는 새 학습은 기존 채팅 그대로
    await page.getByRole('button', { name: '새로 만들기' }).click();
    await expect(main.locator('[data-knowledge-button][data-linked]')).toHaveCount(0);
    await ask(main, '안녕', '일반 답변입니다.');
    expect(cap.systems.at(-1)).not.toContain('<documents>');
    log('11 KB 없는 채팅 OK');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }

  // ── 9. 재시작 후 유지 ──
  ({ app, page, errors } = await launch(userData));
  try {
    await mockLlm(page, cap);
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
    await page.keyboard.press('Escape');
    const st = await stateOf(page, kbId);
    expect(st.status).toBe('ready');
    expect(st.docCount).toBe(5);
    const nav = page.getByRole('navigation', { name: '학습 세션' });
    await nav.locator('[data-tree-title]', { hasText: '쿠버네티스 네트워킹' }).first().click();
    const main = page.locator('[data-panel="main"]');
    await expect(main.locator('[data-citation]').first()).toBeVisible();
    log(`9 재시작 유지 OK ${JSON.stringify(st)}`);

    // 10. 문서 수정 → 증분 재색인
    const docsBefore = await page.evaluate(async (kid) => (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge.docs(kid), kbId);
    const ev0 = await retrieve(page, kbId, ['kubelet', 'sandbox']);
    const filesDir = path.join(userData, 'knowledge', kbId, 'files');
    const all = await readdir(filesDir, { recursive: true });
    const target = all.find((f) => f.endsWith('networking.md'))!;
    await writeFile(path.join(filesDir, target), NETWORKING_MD + '\n## Dual stack\n\nzebrafrog dual-stack clusters assign both IPv4 and IPv6 addresses.\n');
    const progress: unknown[] = [];
    await page.exposeFunction('__smokeProgress', (s: unknown) => progress.push(s));
    await page.evaluate(() => {
      const kn = (window as unknown as { branchDesktop: { knowledge: { onIndexState(l: (s: unknown) => void): () => void } } }).branchDesktop.knowledge;
      kn.onIndexState((s) => (window as unknown as { __smokeProgress(s: unknown): void }).__smokeProgress(s));
    });
    await main.locator('[data-knowledge-button]').click();
    const dialog = page.getByRole('dialog', { name: '지식베이스' });
    const back = dialog.getByRole('button', { name: '목록으로' });
    if (await back.isVisible().catch(() => false)) await back.click();
    await dialog.getByRole('button', { name: new RegExp(`^${KB_NAME}`) }).click();
    await dialog.getByRole('button', { name: '다시 색인' }).click();
    await expect.poll(async () => (await retrieve(page, kbId, ['zebrafrog']))[0]?.path ?? '', { timeout: 60_000 }).toContain('networking.md');
    await waitReady(page, kbId);
    const docsAfter = await page.evaluate(async (kid) => (window as unknown as { branchDesktop: { knowledge: Kn } }).branchDesktop.knowledge.docs(kid), kbId);
    const unchanged = docsBefore.filter((d) => !d.path.endsWith('networking.md'));
    for (const d of unchanged) expect(docsAfter.find((a) => a.path === d.path)?.docId).toBe(d.docId);
    const ev1 = await retrieve(page, kbId, ['kubelet', 'sandbox']);
    const totals = progress.map((p) => (p as { progress?: { phase: string; total: number } }).progress).filter(Boolean);
    log(`10 증분 재색인 OK chunks ${ev0.length}->${ev1.length} progress=${JSON.stringify(totals.slice(-4))}`);
    await page.screenshot({ path: testInfo.outputPath('kb-reindexed.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
