import {
  fitVoiceToModel,
  maskSecret,
  OPENAI_TTS_MODELS,
  openaiVoicesFor,
  secretName,
  ttsModelTakesInstructions,
  type EnAccent,
  type OpenAITtsModel,
  type OpenAIVoice,
  type SpeechLang,
  type TtsEngine,
  type ViAccent,
} from '@branch/core';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { remoteMode } from '../app/capabilities';
import { secrets } from '../app/runtime';
import { actions } from '../app/store';
import { useUi } from '../app/uiState';
import { Button } from '../components/Button';
import { cn } from '../lib/cn';
import { speak, stopSpeaking, useSpeech } from '../voice/speak';
import { Field, Section, Segmented } from './controls';

const KEY = secretName.apiKey('openai-api');

const SAMPLES: [SpeechLang, string, string][] = [
  ['vi', '베트남어', 'Xin chào, rất vui được gặp bạn.'],
  ['en', '영어', 'Nice to meet you. How have you been?'],
  ['ko', '한국어', '만나서 반가워요. 잘 지냈어요?'],
];

const MODEL_LABEL: Record<OpenAITtsModel, string> = {
  'gpt-4o-mini-tts': 'gpt-4o-mini-tts (기본 · 억양 지시)',
  'gpt-4o-mini-tts-2025-12-15': 'gpt-4o-mini-tts-2025-12-15 (스냅샷 · 억양 지시)',
  'tts-1': 'tts-1 (빠름 · 억양 지시 없음)',
  'tts-1-hd': 'tts-1-hd (고음질 · 억양 지시 없음)',
};

const SELECT = 'h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent';

/**
 * 읽어 주기 설정 (ADR-050). 이 기기에만 저장한다.
 * 기본은 기기 음성. OpenAI는 음성 하나만 고르고, 실패하면 기기 음성으로 대신 읽는다.
 */
export function SpeechSettings() {
  const tts = useUi((s) => s.tts);
  const setTts = useUi((s) => s.setTts);
  return (
    <Section title="읽어 주기" hint="답변에서 글을 선택하고 [듣기]를 누르면 읽어 줘요. 베트남어·영어·한국어를 알아서 골라요. 이 기기에만 저장돼요.">
      <Field
        label="음성 엔진"
        hint={
          tts.engine === 'device'
            ? '기기에 내장된 음성으로 읽어요. 무료이고 인터넷이 없어도 돼요. 억양은 기기에 설치된 음성을 따라요.'
            : 'OpenAI 음성으로 읽어요. 키 없음·사용 한도 부족·연결 오류가 나면 기기 음성으로 대신 읽어요.'
        }
      >
        <Segmented<TtsEngine>
          value={tts.engine}
          options={[
            ['device', '기기 음성 (기본)'],
            ['openai', 'OpenAI'],
          ]}
          onChange={(engine) => setTts({ engine })}
        />
      </Field>
      {tts.engine === 'openai' ? (
        <>
          <Field label="모델" hint="공통 설정이에요. tts-1 계열은 억양·말투 지시를 받지 않아요.">
            <select
              value={tts.openaiModel}
              onChange={(e) => {
                const openaiModel = e.target.value as OpenAITtsModel;
                setTts({ openaiModel, openaiVoice: fitVoiceToModel(openaiModel, tts.openaiVoice) });
              }}
              aria-label="OpenAI 음성 모델"
              className={SELECT}
            >
              {OPENAI_TTS_MODELS.map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABEL[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="OpenAI 음성" hint="고른 음성 하나만 써요. 같은 글을 다시 들으면 저장해 둔 소리를 재생해요.">
            <select
              value={tts.openaiVoice}
              onChange={(e) => setTts({ openaiVoice: e.target.value as OpenAIVoice })}
              aria-label="OpenAI 음성"
              className={SELECT}
            >
              {openaiVoicesFor(tts.openaiModel).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <OpenAIKeyField />
          <LangTabs />
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map(([lang, label, text]) => (
            <Button key={lang} size="sm" variant="soft" icon={<Volume2 size={14} />} onClick={() => speak(text, { lang })}>
              {label} 들어 보기
            </Button>
          ))}
          <StopButton />
        </div>
      )}
    </Section>
  );
}

function StopButton() {
  const speaking = useSpeech((s) => s.status !== 'idle');
  if (!speaking) return null;
  return (
    <Button size="sm" variant="ghost" icon={<Square size={13} />} onClick={stopSpeaking}>
      멈춤
    </Button>
  );
}

/** OpenAI 언어별 설정 — 탭으로 나눠 억양을 고르고 들어 본다 */
function LangTabs() {
  const tts = useUi((s) => s.tts);
  const setTts = useUi((s) => s.setTts);
  const [tab, setTab] = useState<SpeechLang>('vi');
  const sample = SAMPLES.find(([l]) => l === tab)!;
  const takes = ttsModelTakesInstructions(tts.openaiModel);
  const off = takes ? undefined : '지금 모델(tts-1 계열)은 억양 지시를 받지 않아요. 억양을 바꾸려면 gpt-4o-mini-tts를 골라 주세요.';
  return (
    <div className="rounded-lg border border-line">
      <div role="tablist" aria-label="언어별 설정" className="flex border-b border-line px-1">
        {SAMPLES.map(([lang, label]) => (
          <button
            key={lang}
            type="button"
            role="tab"
            aria-selected={tab === lang}
            onClick={() => setTab(lang)}
            className={cn(
              '-mb-px h-10 border-b-2 px-3 text-[13.5px]',
              tab === lang ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-3 p-3">
        {tab === 'vi' && (
          <Field label="억양" hint={off ?? '북부는 하노이 표준, 남부는 호찌민(사이공) 억양으로 읽어요.'}>
            <Segmented<ViAccent>
              value={tts.viAccent}
              options={[
                ['north', '북부 (하노이)'],
                ['south', '남부 (호찌민)'],
              ]}
              onChange={(viAccent) => setTts({ viAccent })}
            />
          </Field>
        )}
        {tab === 'en' && (
          <Field label="억양" hint={off}>
            <Segmented<EnAccent>
              value={tts.enAccent}
              options={[
                ['us', '미국'],
                ['uk', '영국'],
              ]}
              onChange={(enAccent) => setTts({ enAccent })}
            />
          </Field>
        )}
        {tab === 'ko' && <p className="text-[12.5px] text-muted">한국어는 표준어로 또박또박 읽어요.</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" icon={<Volume2 size={14} />} onClick={() => speak(sample[2], { lang: tab })}>
            {sample[1]} 들어 보기
          </Button>
          <StopButton />
        </div>
      </div>
    </div>
  );
}

/** 이 기기에 저장된 OpenAI 키 (연결 탭의 OpenAI API 키와 같은 것). 원격 전용 기기는 여기서 넣는다 */
function OpenAIKeyField() {
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [key, setKey] = useState('');
  const reload = () => void secrets.get(KEY).then((k) => setSaved(k ?? null));
  useEffect(reload, []);

  const done = () => {
    if (!remoteMode) void actions().refreshConnections(['openai-api']);
    reload();
  };
  const save = async () => {
    const k = key.trim();
    if (!k) return;
    await secrets.set(KEY, k);
    setKey('');
    done();
  };
  const remove = async () => {
    await secrets.delete(KEY);
    done();
  };

  if (saved === undefined) return null;
  return (
    <Field
      label="OpenAI API 키"
      hint={
        saved
          ? `저장됨 (${maskSecret(saved)})${remoteMode ? '' : ' · 연결 탭의 OpenAI 키와 같아요.'}`
          : `키가 없으면 기기 음성으로 읽어요.${secrets.kind === 'memory' ? ' 웹에서는 탭을 닫으면 지워져요.' : ''}`
      }
    >
      {saved ? (
        <Button size="sm" variant="ghost" onClick={() => void remove()}>
          키 지우기
        </Button>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-…"
            aria-label="OpenAI API 키"
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!key.trim()}>
            저장
          </Button>
        </form>
      )}
    </Field>
  );
}
