import { gradeQuiz, parseQuiz, quizAnswerLabel, QUIZ_LANG, type Quiz, type QuizAnswer, type QuizQuestion } from '@branch/core';
import type { Element, ElementContent } from 'hast';
import { Check, ChevronRight, ListChecks, RotateCcw, X } from 'lucide-react';
import { createContext, memo, useContext, useState, type ComponentProps, type FormEvent } from 'react';
import ReactMarkdown, { type ExtraProps, type Options } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';

/** 퀴즈 블록이 놓인 메시지 (풀이 상태 키, 생성 중 표시) */
export const QuizContext = createContext<{ messageId?: string; streaming?: boolean }>({});

function textOf(node: ElementContent): string {
  if (node.type === 'text') return node.value;
  return node.type === 'element' ? node.children.map(textOf).join('') : '';
}

/** 언어 이름이 lang인 코드 블록이면 그 본문 */
export function codeSource(node: Element | undefined, lang: string): string | null {
  const code = node?.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
  const cls = code?.properties.className;
  const match = Array.isArray(cls) && cls.includes(`language-${lang}`);
  return code && match ? textOf(code) : null;
}

/** ```quiz 코드 블록이면 그 본문 */
export const quizSource = (node: Element | undefined) => codeSource(node, QUIZ_LANG);

/* ── 풀이 상태: 다시 그려져도(가상 스크롤·탭 이동) 이어서 풀도록 기억한다 ── */

interface Result {
  answer: QuizAnswer;
  correct: boolean;
}
interface Progress {
  index: number;
  results: (Result | null)[];
}

const STORE_PREFIX = 'rb.quiz.';
const memory = new Map<string, Progress>();

function loadProgress(key: string, count: number): Progress {
  const cached = memory.get(key);
  if (cached) return cached;
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_PREFIX + key) ?? 'null') as Progress | null;
    if (raw && Number.isInteger(raw.index) && Array.isArray(raw.results) && raw.results.length === count && raw.index <= count) return raw;
  } catch {
    /* 저장 값이 깨졌으면 처음부터 */
  }
  return { index: 0, results: Array<Result | null>(count).fill(null) };
}

function saveProgress(key: string, p: Progress) {
  memory.set(key, p);
  try {
    localStorage.setItem(STORE_PREFIX + key, JSON.stringify(p));
  } catch {
    /* 저장소를 못 써도 이번 실행 동안은 기억한다 */
  }
}

/* ── 문제·보기·해설 안의 마크다운 (굵게·코드·수식) ── */

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkCjkFriendly, remarkMath];
const rehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, { throwOnError: false, strict: 'ignore' }]];
const inlineComponents: Options['components'] = { p: ({ children }) => <>{children}</> };

const QuizText = memo(function QuizText({ text, inline }: { text: string; inline?: boolean }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={inline ? inlineComponents : undefined} skipHtml>
      {text}
    </ReactMarkdown>
  );
});

const TYPE_LABEL: Record<QuizQuestion['type'], string> = { ox: 'OX', choice: '객관식', short: '주관식' };

/**
 * 코드 블록(pre) 자리에 퀴즈 카드를 그린다.
 * 원래 코드 블록은 숨긴 채 남겨 두어 렌더 텍스트(가지 앵커 위치 계산)가 원문과 어긋나지 않게 한다.
 */
export function QuizBlock({ node, source, children, ...props }: ComponentProps<'pre'> & ExtraProps & { source: string }) {
  const { messageId, streaming } = useContext(QuizContext);
  const quiz = streaming ? null : parseQuiz(source);
  const hidden = (
    <pre {...props} hidden>
      {children}
    </pre>
  );
  if (!quiz && !streaming) return <pre {...props}>{children}</pre>;
  const key = `${messageId ?? 'local'}:${node?.position?.start.offset ?? 0}`;
  return (
    <div className="quiz-block">
      <div data-anchor-ignore data-quiz className="quiz-card my-3 overflow-hidden rounded-2xl border border-accent/25 bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_6px_20px_rgb(0_0_0/0.05)]">
        {quiz ? (
          <QuizRunner key={key} quiz={quiz} storeKey={key} />
        ) : (
          <div className="flex items-center gap-2 px-4 py-3.5 text-[14px] text-muted">
            <ListChecks size={16} className="text-accent" />
            퀴즈를 만드는 중…
          </div>
        )}
      </div>
      {hidden}
    </div>
  );
}

function QuizRunner({ quiz, storeKey }: { quiz: Quiz; storeKey: string }) {
  const total = quiz.questions.length;
  const [progress, setProgress] = useState(() => loadProgress(storeKey, total));
  const update = (p: Progress) => {
    saveProgress(storeKey, p);
    setProgress(p);
  };
  const { index, results } = progress;
  const done = index >= total;
  const answered = results.filter(Boolean).length;
  const score = results.filter((r) => r?.correct).length;

  const answer = (value: QuizAnswer) => {
    const q = quiz.questions[index]!;
    const next = [...results];
    next[index] = { answer: value, correct: gradeQuiz(q, value) };
    update({ index, results: next });
  };
  const markCorrect = () => {
    const next = [...results];
    next[index] = { ...next[index]!, correct: true };
    update({ index, results: next });
  };

  return (
    <>
      <header className="border-b border-line bg-accent-soft/60 px-4 pt-3 pb-2.5">
        <div className="flex items-center gap-2">
          <ListChecks size={16} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{quiz.title}</span>
          <span className="shrink-0 text-[12.5px] font-medium text-accent tabular-nums">
            {done ? `${score} / ${total} 정답` : `${index + 1} / ${total}`}
          </span>
        </div>
        <div className="mt-2 flex gap-1" aria-hidden>
          {results.map((r, i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full',
                r ? (r.correct ? 'bg-ok' : 'bg-danger') : i === index ? 'bg-accent/50' : 'bg-line',
              )}
            />
          ))}
        </div>
      </header>
      {done ? (
        <QuizSummary quiz={quiz} results={results} onRestart={() => update({ index: 0, results: Array<Result | null>(total).fill(null) })} />
      ) : (
        <QuestionView
          key={index}
          question={quiz.questions[index]!}
          result={results[index] ?? null}
          isLast={index === total - 1}
          onAnswer={answer}
          onMarkCorrect={markCorrect}
          onNext={() => update({ index: index + 1, results })}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {answered ? `${answered}문제 풀었어요` : ''}
      </span>
    </>
  );
}

interface QuestionViewProps {
  question: QuizQuestion;
  result: Result | null;
  isLast: boolean;
  onAnswer(value: QuizAnswer): void;
  onMarkCorrect(): void;
  onNext(): void;
}

function QuestionView({ question: q, result, isLast, onAnswer, onMarkCorrect, onNext }: QuestionViewProps) {
  return (
    <div className="space-y-3 px-4 py-3.5">
      <div>
        <span className="mb-1.5 inline-block rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] font-semibold text-fg-2">{TYPE_LABEL[q.type]}</span>
        <div className="quiz-text text-[15px] leading-relaxed font-medium text-fg">
          <QuizText text={q.question} />
        </div>
      </div>

      {q.type === 'ox' && <OxChoices question={q} result={result} onAnswer={onAnswer} />}
      {q.type === 'choice' && <ChoiceList question={q} result={result} onAnswer={onAnswer} />}
      {q.type === 'short' && <ShortAnswer result={result} onAnswer={onAnswer} />}

      {result && (
        <div
          role="status"
          className={cn('rounded-xl border px-3 py-2.5 text-[14px]', result.correct ? 'border-ok/30 bg-accent-soft' : 'border-danger/30 bg-danger-soft')}
        >
          <div className={cn('flex items-center gap-1.5 font-semibold', result.correct ? 'text-ok' : 'text-danger')}>
            {result.correct ? <Check size={16} /> : <X size={16} />}
            {result.correct ? '정답이에요!' : '아쉬워요, 틀렸어요'}
          </div>
          <div className="mt-1 text-fg">
            <span className="text-muted">정답 </span>
            <span className="quiz-text font-medium">
              {/* "2. 보기"를 마크다운에 넘기면 순서 목록이 되므로 번호는 따로 쓴다 */}
              {q.type === 'choice' && `${q.answer + 1}번 `}
              <QuizText text={q.type === 'choice' ? q.choices[q.answer]! : quizAnswerLabel(q)} inline />
            </span>
          </div>
          {q.explanation && (
            <div className="quiz-text mt-1.5 leading-relaxed text-fg-2">
              <QuizText text={q.explanation} />
            </div>
          )}
          {!result.correct && q.type === 'short' && (
            <button type="button" onClick={onMarkCorrect} className="-mx-1 mt-1 min-h-9 px-1 text-[13px] text-muted underline underline-offset-2 hover:text-fg">
              같은 뜻으로 답했어요 — 정답으로 처리
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={onNext}>
            {isLast ? '결과 보기' : '다음 문제'}
            <ChevronRight size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}

/** 답한 뒤 보기 색: 정답은 초록, 고른 오답은 빨강, 나머지는 흐리게 */
function choiceTone(isAnswer: boolean, picked: boolean, result: Result | null): string {
  if (!result) return 'border-line bg-surface hover:border-accent/50 hover:bg-accent-soft/50';
  if (isAnswer) return 'border-ok bg-accent-soft text-fg ring-1 ring-ok';
  if (picked) return 'border-danger bg-danger-soft text-fg ring-1 ring-danger';
  return 'border-line bg-surface opacity-60';
}

function OxChoices({ question, result, onAnswer }: { question: Extract<QuizQuestion, { type: 'ox' }>; result: Result | null; onAnswer(v: boolean): void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((v) => (
        <button
          key={String(v)}
          type="button"
          disabled={!!result}
          aria-pressed={result?.answer === v}
          aria-label={v ? 'O (맞다)' : 'X (틀리다)'}
          onClick={() => onAnswer(v)}
          className={cn(
            'flex h-16 items-center justify-center rounded-xl border-2 text-[28px] font-bold transition-colors disabled:cursor-default',
            v ? 'text-accent' : 'text-danger',
            choiceTone(question.answer === v, result?.answer === v, result),
          )}
        >
          {v ? 'O' : 'X'}
        </button>
      ))}
    </div>
  );
}

function ChoiceList({ question, result, onAnswer }: { question: Extract<QuizQuestion, { type: 'choice' }>; result: Result | null; onAnswer(v: number): void }) {
  return (
    <div role="list" className="space-y-1.5">
      {question.choices.map((c, i) => (
        <div role="listitem" key={i}>
          <button
            type="button"
            disabled={!!result}
            aria-pressed={result?.answer === i}
            onClick={() => onAnswer(i)}
            className={cn(
              'flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[14.5px] leading-snug transition-colors disabled:cursor-default',
              choiceTone(question.answer === i, result?.answer === i, result),
            )}
          >
            <span
              className={cn(
                'mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-semibold',
                result && question.answer === i ? 'border-ok bg-ok text-white' : result?.answer === i ? 'border-danger bg-danger text-white' : 'border-line-strong text-fg-2',
              )}
            >
              {i + 1}
            </span>
            <span className="quiz-text min-w-0">
              <QuizText text={c} inline />
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

function ShortAnswer({ result, onAnswer }: { result: Result | null; onAnswer(v: string): void }) {
  const [value, setValue] = useState(typeof result?.answer === 'string' ? result.answer : '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onAnswer(value.trim());
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={!!result}
        placeholder="답을 입력하세요"
        aria-label="주관식 답"
        enterKeyHint="done"
        className={cn(
          'h-10 min-w-0 flex-1 rounded-xl border bg-surface px-3 text-[15px] text-fg outline-none placeholder:text-muted focus:border-accent disabled:opacity-80',
          result ? (result.correct ? 'border-ok' : 'border-danger') : 'border-line',
        )}
      />
      {!result && (
        <Button type="submit" variant="primary" disabled={!value.trim()}>
          제출
        </Button>
      )}
    </form>
  );
}

function QuizSummary({ quiz, results, onRestart }: { quiz: Quiz; results: (Result | null)[]; onRestart(): void }) {
  const total = quiz.questions.length;
  const score = results.filter((r) => r?.correct).length;
  const message = score === total ? '모두 맞혔어요!' : score >= total / 2 ? '잘했어요. 틀린 문제만 다시 볼까요?' : '헷갈린 개념을 다시 짚어 봐요.';
  return (
    <div className="space-y-3 px-4 py-3.5">
      <div className="text-center">
        <div className="text-[28px] font-bold text-fg tabular-nums">
          {score}
          <span className="text-[18px] font-medium text-muted"> / {total}</span>
        </div>
        <div className="text-[14px] text-fg-2">{message}</div>
      </div>
      <div role="list" className="divide-y divide-line rounded-xl border border-line">
        {quiz.questions.map((q, i) => (
          <div role="listitem" key={i} className="flex items-start gap-2 px-3 py-2 text-[13.5px]">
            {results[i]?.correct ? <Check size={15} className="mt-0.5 shrink-0 text-ok" /> : <X size={15} className="mt-0.5 shrink-0 text-danger" />}
            <span className="quiz-text min-w-0 flex-1 text-fg-2">
              <QuizText text={q.question} inline />
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end">
        <Button size="sm" icon={<RotateCcw size={14} />} onClick={onRestart}>
          다시 풀기
        </Button>
      </div>
    </div>
  );
}
