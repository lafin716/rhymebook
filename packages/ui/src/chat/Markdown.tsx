import { pageLinkId, type ID, type SegmentMap, type Annotation } from '@branch/core';
import 'katex/dist/katex.min.css';
import { FileText } from 'lucide-react';
import { createContext, memo, useContext, useMemo, type ComponentProps } from 'react';
import ReactMarkdown, { defaultUrlTransform, type ExtraProps, type Options, type UrlTransform } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { rehypeAnchors, rehypeMathSource, type AnchorMark } from './anchorPlugin';
import { rehypeSvgPreview, svgRanges } from './svgPlugin';
import { QuizBlock, QuizContext, quizSource } from './QuizCard';
import { SpeakBlock, speakSource } from './SpeakCard';
import { SvgPreview } from './SvgPreview';
import { actions, useApp } from '../app/store';

export interface MarkdownProps {
  content: string;
  messageId?: ID;
  anchors?: AnchorMark[];
  annotations?: Annotation[];
  onMap?: (map: SegmentMap, located: Record<ID, boolean>) => void;
  /** 답변 생성 중 (퀴즈·읽기 블록은 다 받은 뒤 카드로) */
  streaming?: boolean;
}

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkCjkFriendly, remarkMath];
/** ```quiz 블록은 퀴즈 카드, ```speak 블록은 읽기 카드, 나머지 코드 블록은 SVG 미리보기/일반 코드 */
function Pre(props: ComponentProps<'pre'> & ExtraProps) {
  const quiz = quizSource(props.node);
  if (quiz !== null) return <QuizBlock {...props} source={quiz} />;
  const said = speakSource(props.node);
  return said === null ? <SvgPreview {...props} /> : <SpeakBlock {...props} source={said} />;
}

/**
 * 페이지에 넣은 첨부(data URL)는 살린다 — 이미지는 png·jpeg·gif·webp만, 링크는 html·svg처럼 문서로 열리는 형식 빼고.
 * 나머지는 기본 규칙 (ADR-077)
 */
const urlTransform: UrlTransform = (url, key) => {
  if (!url.startsWith('data:')) return defaultUrlTransform(url);
  if (key === 'src') return /^data:image\/(?:png|jpeg|gif|webp)[;,]/i.test(url) ? url : '';
  if (key === 'href') return /^data:(?:text\/html|image\/svg|application\/xhtml|text\/xml|application\/xml)/i.test(url) ? '' : url;
  return '';
};

/**
 * 읽기 모드 페이지의 할 일 체크박스 — 값이 있으면 체크박스를 눌러 바꿀 수 있다.
 * 받는 값은 누른 체크박스와 바뀔 상태 (ADR-077)
 */
export const TaskToggleContext = createContext<((box: HTMLInputElement, checked: boolean) => void) | null>(null);

function Input({ node: _node, ...rest }: ComponentProps<'input'> & ExtraProps) {
  const toggle = useContext(TaskToggleContext);
  if (rest.type !== 'checkbox' || !toggle) return <input {...rest} />;
  return (
    <input
      {...rest}
      disabled={false}
      data-task-toggle=""
      aria-label={rest.checked ? '완료 취소' : '완료'}
      onChange={(e) => toggle(e.currentTarget, e.currentTarget.checked)}
    />
  );
}

/** `#page:<id>` 링크는 하위 페이지로 연다 (ADR-075). data URL 첨부는 내려받는다 */
function Anchor({ node: _node, href, children, ...rest }: ComponentProps<'a'> & ExtraProps) {
  const id = pageLinkId(href);
  const exists = useApp((s) => (id ? !!s.sessions[id] : false));
  if (!id)
    return href?.startsWith('data:') ? (
      <a href={href} {...rest} download={rest.title || true}>
        {children}
      </a>
    ) : (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  return (
    <a
      {...rest}
      href={href}
      data-page-link={id}
      aria-disabled={!exists || undefined}
      title={exists ? '하위 페이지 열기' : '지워진 페이지'}
      className={exists ? 'page-link' : 'page-link page-link-missing'}
      onClick={(e) => {
        e.preventDefault();
        if (exists) actions().openSession(id, 'main');
      }}
    >
      <FileText size={14} aria-hidden="true" className="page-link-icon" />
      {children}
    </a>
  );
}

const components: Options['components'] = { pre: Pre, a: Anchor, input: Input };

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
      <ReactMarkdown components={components} remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
    </QuizContext.Provider>
  );
});
