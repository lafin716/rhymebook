/**
 * 텍스트 정규화·토큰화 (키워드 색인·문맥어·로컬 해시 임베딩 공용).
 * - 영문·숫자 단어는 소문자 원어 그대로.
 * - 한글·한자·가나 덩어리는 원어절(eojeol) + 2-gram을 낸다 (조사가 붙어도 검색되도록).
 * - 불용어는 뺀다. 플랫폼 무관 (정규식 유니코드 속성만 쓴다).
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'are', 'was', 'were',
  'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'as', 'do', 'does', 'did', 'how', 'what', 'which', 'who',
  'can', 'could', 'should', 'would', 'will', 'me', 'my', 'we', 'you', 'your', 'they', 'them', 'then', 'there', 'so', 'if',
  '이', '그', '저', '것', '수', '등', '좀', '및', '또는', '그리고', '에서', '으로', '에게', '에는', '하는', '있는', '그럼',
  '이거', '그거', '저거', '그건', '이건', '저건', '여기서', '거기', '그때', '이때', '걔',
  // 영문 뒤에 붙어 떨어져 나온 한 글자 조사 (IP는 → ip, 는)
  '은', '는', '가', '을', '를', '의', '에', '도', '와', '과', '로', '만',
  // 의문사·요청어 (질문마다 나와 검색 신호가 없다)
  '어떻게', '무엇', '무엇을', '무엇인가', '뭐', '뭐야', '뭔가', '왜', '언제', '어디', '어디서', '누가', '누구', '알려줘', '설명해줘',
]);

/** CJK 덩어리 또는 CJK가 아닌 글자·숫자 덩어리. 문자 체계가 바뀌는 곳에서 끊는다 (IPAM이 → ipam, 이) */
const WORD_RE =
  /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|(?:(?![\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}])+/gu;
const CJK_RE = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;

/** NFKC 정규화 + 소문자 + 제로폭 문자 제거 + 공백 압축 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 검색용 토큰. 중복을 유지한다 (빈도가 필요한 쪽이 있다). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const norm = normalizeText(text);
  for (const m of norm.matchAll(WORD_RE)) {
    const w = m[0];
    if (CJK_RE.test(w)) {
      const chars = [...w];
      if (chars.length === 1) {
        if (!STOPWORDS.has(w)) out.push(w);
        continue;
      }
      // 불용어 어절은 2-gram도 내지 않는다 (어떻게 → 어떻·떻게가 남지 않게)
      if (STOPWORDS.has(w)) continue;
      out.push(w);
      for (let i = 0; i + 1 < chars.length; i++) {
        const bi = `${chars[i] ?? ""}${chars[i + 1] ?? ""}`;
        if (!STOPWORDS.has(bi)) out.push(bi);
      }
    } else if (!STOPWORDS.has(w)) {
      out.push(w);
    }
  }
  return out;
}
