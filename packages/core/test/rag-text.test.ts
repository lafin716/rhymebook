import { describe, expect, it } from 'vitest';
import { chunkDocument, docKindOf, isIndexablePath, normalizeText, parseDocument, sha256Hex, tokenize } from '../src/rag';

describe('rag tokenize', () => {
  it('정규화하고 소문자 토큰으로 나눈다', () => {
    expect(normalizeText('  Hello   WORLD ')).toBe(normalizeText('hello world'));
    const toks = tokenize('Kubernetes Pod, kubectl apply');
    expect(toks).toContain('kubernetes');
    expect(toks).toContain('pod');
    expect(toks.every((t) => t === t.toLowerCase())).toBe(true);
  });

  it('영문 뒤에 붙은 조사를 떼어 영문 용어로 검색되게 한다 (IP는 → ip)', () => {
    const toks = tokenize('그럼 IP는 누가 할당해? CNI의 IPAM이 담당');
    expect(toks).toContain('ip');
    expect(toks).toContain('ipam');
    expect(toks).toContain('cni');
    expect(toks).not.toContain('ip는');
    expect(toks).not.toContain('는');
    expect(toks).toContain('할당');
  });
});

describe('rag sha256Hex', () => {
  it('표준 벡터와 일치한다', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('rag parse', () => {
  it('종류를 확장자로 정하고 색인 대상을 거른다', () => {
    expect(docKindOf('docs/a.md')).toBe('markdown');
    expect(docKindOf('src/x.ts')).toBe('code');
    expect(docKindOf('image.png')).toBeNull();
    expect(isIndexablePath('docs/a.md')).toBe(true);
    expect(isIndexablePath('image.png')).toBe(false);
  });

  it('마크다운 제목과 본문 블록을 뽑는다', () => {
    const doc = parseDocument({ path: 'notes/net.md', text: '# 네트워크\n\n## IPAM\n\nCIDR 블록을 나눈다.\n' });
    expect(doc.kind).toBe('markdown');
    expect(doc.blocks.some((b) => b.type === 'heading' && b.text === 'IPAM')).toBe(true);
    expect(doc.blocks.some((b) => b.type === 'paragraph' && b.text.includes('CIDR'))).toBe(true);
  });
});

describe('rag chunk', () => {
  it('섹션(부모)과 리프(자식)를 만들고 리프의 부모는 섹션이다', () => {
    const text = ['# Net', '', '## IPAM', '', '서브넷을 나눈다. '.repeat(40), '', '## DNS', '', '이름을 푼다.'].join('\n');
    const doc = parseDocument({ path: 'net.md', text });
    const chunks = chunkDocument(doc, 'doc1');
    const sections = chunks.filter((c) => c.level === 'section');
    const leaves = chunks.filter((c) => c.level === 'leaf');
    expect(sections.length).toBeGreaterThan(0);
    expect(leaves.length).toBeGreaterThan(0);
    const sectionIds = new Set(sections.map((s) => s.id));
    for (const leaf of leaves) expect(sectionIds.has(leaf.parentId ?? '')).toBe(true);
    for (const c of chunks) expect(c.hash).toHaveLength(32);
  });

  it('블록이 없으면 빈 배열', () => {
    expect(chunkDocument({ path: 'e.md', kind: 'markdown', title: 'e', blocks: [] }, 'd')).toEqual([]);
  });
});
