import { useState, type ComponentProps } from 'react';
import type { ExtraProps } from 'react-markdown';
import { svgDocument } from './svgPlugin';

/** img의 독립 이미지 문맥을 사용한다. 원본 코드는 앵커 맵과 일치하도록 유지한다. */
export function SvgPreview({ node, children, ...props }: ComponentProps<'pre'> & ExtraProps) {
  const original = node?.properties.dataSvgSource;
  const svg = typeof original === 'string' ? svgDocument(original) : null;
  const src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  const [failed, setFailed] = useState<string | null>(null);
  const preProps = { ...props } as ComponentProps<'pre'> & { 'data-svg-source'?: string };
  delete preProps['data-svg-source'];
  const code = <pre {...preProps}>{children}</pre>;
  if (!src || failed === src) return code;
  return (
    <div className="svg-preview" data-svg-preview>
      <img src={src} alt="SVG 이미지" onError={() => setFailed(src)} />
      <details>
        <summary data-anchor-ignore>SVG 코드 보기</summary>
        {code}
      </details>
    </div>
  );
}
