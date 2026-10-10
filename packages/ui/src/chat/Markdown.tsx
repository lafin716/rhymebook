import type { ID, SegmentMap } from '@branch/core';
import { memo, useMemo } from 'react';
import ReactMarkdown, { type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { rehypeAnchors, type AnchorMark } from './anchorPlugin';

export interface MarkdownProps {
  content: string;
  anchors?: AnchorMark[];
  onMap?: (map: SegmentMap, located: Record<ID, boolean>) => void;
}

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm];

/** 마크다운 + 코드 하이라이트 + 가지 앵커 하이라이트 */
export const Markdown = memo(function Markdown({ content, anchors, onMap }: MarkdownProps) {
  const key = anchors?.map((a) => `${a.sessionId}:${a.startOffset}:${a.hasSummary ? 1 : 0}`).join('|') ?? '';
  const rehypePlugins = useMemo<Options['rehypePlugins']>(
    () => [
      [rehypeHighlight, { plainText: ['text', 'txt'] }],
      [rehypeAnchors, { anchors: anchors ?? [], onMap }],
    ],
    // anchors 배열 동일성 대신 내용 key로 메모이즈
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, onMap],
  );
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
      {content}
    </ReactMarkdown>
  );
});
