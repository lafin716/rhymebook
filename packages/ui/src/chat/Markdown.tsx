import type { ID, SegmentMap, Annotation } from '@branch/core';
import 'katex/dist/katex.min.css';
import { memo, useMemo, type ComponentProps } from 'react';
import ReactMarkdown, { type ExtraProps, type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeAnchors, rehypeMathSource, type AnchorMark } from './anchorPlugin';
import { rehypeSvgPreview, svgRanges } from './svgPlugin';
import { QuizBlock, QuizContext, quizSource } from './QuizCard';
import { SpeakBlock, speakSource } from './SpeakCard';
import { SvgPreview } from './SvgPreview';

export interface MarkdownProps {
  content: string;
  messageId?: ID;
  anchors?: AnchorMark[];
  annotations?: Annotation[];
  onMap?: (map: SegmentMap, located: Record<ID, boolean>) => void;
  /** 답변 생성 중 (퀴즈·읽기 블록은 다 받은 뒤 카드로) */
  streaming?: boolean;
}

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];
/** ```quiz 블록은 퀴즈 카드, ```speak 블록은 읽기 카드, 나머지 코드 블록은 SVG 미리보기/일반 코드 */
function Pre(props: ComponentProps<'pre'> & ExtraProps) {
  const quiz = quizSource(props.node);
  if (quiz !== null) return <QuizBlock {...props} source={quiz} />;
  const said = speakSource(props.node);
  return said === null ? <SvgPreview {...props} /> : <SpeakBlock {...props} source={said} />;
}

const components: Options['components'] = { pre: Pre };

/** 코드(펜스 블록·인라인 코드) 영역 마스크. 수식 구분자 변환에서 제외한다 */
function codeMask(src: string): Uint8Array {
  const mask = new Uint8Array(src.length);
  const mark = (from: number, to: number) => mask.fill(1, from, to);
  // 펜스 코드 블록 (``` / ~~~, 닫는 펜스가 없으면 문서 끝까지)
  let fence: { ch: string; len: number; start: number } | null = null;
  let pos = 0;
  for (const line of src.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1]![0] === fence.ch && m[1]!.length >= fence.len && line.trim() === m[1]) {
        mark(fence.start, pos + line.length);
        fence = null;
      }
    } else if (m) {
      fence = { ch: m[1]![0]!, len: m[1]!.length, start: pos };
    }
    pos += line.length + 1;
  }
  if (fence) mark(fence.start, src.length);
  // 인라인 코드 (같은 길이의 백틱 묶음 사이)
  const re = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (!mask[m.index]) mark(m.index, m.index + m[0].length);
  }
  for (const range of svgRanges(src, mask)) mark(range.start, range.end);
  return mask;
}

/** i 앞에 붙은 역슬래시가 짝수 개인가 (= i의 역슬래시가 이스케이프되지 않았나) */
function unescaped(src: string, i: number): boolean {
  let n = 0;
  for (let k = i - 1; k >= 0 && src[k] === '\\'; k--) n++;
  return n % 2 === 0;
}

const lineStartAt = (src: string, i: number) => /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i));
const lineEndAt = (src: string, i: number) => {
  const nl = src.indexOf('\n', i);
  return /^[ \t]*$/.test(src.slice(i, nl < 0 ? src.length : nl));
};

/**
 * LaTeX 구분자 `\[…\]`, `\(…\)`를 remark-math 구분자로 바꾼다.
 * 앵커가 원문 offset을 쓰므로 반드시 같은 길이로 바꾼다: `\[`→`$$`, `\]`→`$$`, `\(`→`$ `, `\)`→` $`.
 * 코드 안은 건드리지 않고, 짝이 확실한 경우만 바꾼다 (블록은 여는/닫는 줄이 각각 단독일 때 또는 한 줄일 때만).
 */
export function normalizeMathDelimiters(src: string): string {
  if (!src.includes('\\[') && !src.includes('\\(')) return src;
  const mask = codeMask(src);
  const out = src.split('');
  const clean = (from: number, to: number) => !mask.subarray(from, to).some((v) => v);
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] !== '\\' || mask[i] || !unescaped(src, i)) continue;
    const open = src[i + 1];
    if (open !== '[' && open !== '(') continue;
    const closer = open === '[' ? '\\]' : '\\)';
    let j = src.indexOf(closer, i + 2);
    while (j >= 0 && !unescaped(src, j)) j = src.indexOf(closer, j + 1);
    if (j < 0 || j === i + 2) continue;
    const body = src.slice(i + 2, j);
    if (!body.trim() || !clean(i, j + 2)) continue;
    const singleLine = !body.includes('\n');
    if (open === '(') {
      if (!singleLine) continue;
      out[i] = '$';
      out[i + 1] = ' ';
      out[j] = ' ';
      out[j + 1] = '$';
    } else {
      // 여러 줄 블록은 여는 `\[`·닫는 `\]`가 각자 줄에 단독일 때만 (아니면 닫히지 않은 수식 블록이 뒤를 삼킨다)
      const block = lineStartAt(src, i) && lineEndAt(src, i + 2) && lineStartAt(src, j) && lineEndAt(src, j + 2);
      if (!singleLine && !block) continue;
      if (body.includes('\n\n')) continue;
      out[i] = out[i + 1] = '$';
      out[j] = out[j + 1] = '$';
    }
    i = j + 1;
  }
  return out.join('');
}

/** 마크다운 + 수식(KaTeX) + 코드 하이라이트 + 가지 앵커 + 어노테이션 */
export const Markdown = memo(function Markdown({
  content,
  messageId,
  anchors,
  annotations,
  onMap,
  streaming,
}: MarkdownProps) {
  const anchorKey = anchors?.map((a) => `${a.sessionId}:${a.startOffset}:${a.hasSummary ? 1 : 0}`).join('|') ?? '';
  const annotKey = annotations?.map((a) => `${a.id}:${a.anchor.startOffset}:${a.updatedAt}`).join('|') ?? '';
  const key = `${anchorKey}|${annotKey}`;
  const rehypePlugins = useMemo<Options['rehypePlugins']>(
    () => [
      rehypeSvgPreview,
      // 수식은 KaTeX가 코드 하이라이트보다 먼저 (math 코드 요소를 KaTeX 출력으로 바꾼다)
      rehypeMathSource,
      [rehypeKatex, { throwOnError: false, strict: 'ignore' }],
      [rehypeHighlight, { plainText: ['text', 'txt'] }],
      [
        rehypeAnchors,
        {
          anchors: anchors ?? [],
          annotations: annotations ?? [],
          messageId,
          onMap,
        },
      ],
    ],
    // anchors/annotations 배열 동일성 대신 내용 key로 메모이즈
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, messageId, onMap],
  );
  const source = useMemo(() => normalizeMathDelimiters(content), [content]);
  const quiz = useMemo(() => ({ messageId, streaming }), [messageId, streaming]);
  return (
    <QuizContext.Provider value={quiz}>
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
        {source}
      </ReactMarkdown>
    </QuizContext.Provider>
  );
});
