import { RotateCcw } from 'lucide-react';
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { cn } from '../lib/cn';

interface Props {
  children: ReactNode;
  /** 어디서 났는지 로그에 남길 이름 */
  name: string;
  /** 화면 전체(루트)인지 — 문구·크기만 다르다 */
  full?: boolean;
  /** 아무것도 그리지 않고 조용히 숨긴다 (떠 있는 막대 등) */
  silent?: boolean;
}

interface State {
  error: Error | null;
  /** 다시 시도할 때마다 늘려 자식을 새로 만든다 */
  attempt: number;
}

/**
 * 그리다 예외가 나도 화면 전체가 하얗게 비지 않게 하는 안전망.
 * 예외 난 부분만 안내와 '다시 시도'로 바꾼다.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] 화면 그리기 오류`, error, info.componentStack);
  }

  private retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  override render() {
    const { error, attempt } = this.state;
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>;
    if (this.props.silent) return null;
    return (
      <div
        role="alert"
        data-error-boundary={this.props.name}
        className={cn(
          'flex flex-col items-center justify-center gap-2 px-6 text-center',
          this.props.full ? 'h-dvh' : 'rounded-xl border border-line py-8',
        )}
      >
        <p className="text-[15px] font-semibold">화면을 그리다 문제가 생겼어요</p>
        <p className="max-w-xs text-[13px] text-muted">작성한 내용은 저장돼 있어요. 다시 시도해 주세요.</p>
        <button
          type="button"
          onClick={this.props.full ? () => window.location.reload() : this.retry}
          className="mt-2 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[14px] font-medium text-accent-fg"
        >
          <RotateCcw size={15} />
          다시 시도
        </button>
      </div>
    );
  }
}
