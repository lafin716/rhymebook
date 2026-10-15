import { maskSecret, OPENAI_VOICES, secretName, type OpenAIVoice, type TtsEngine } from '@branch/core';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { remoteMode } from '../app/capabilities';
import { secrets } from '../app/runtime';
import { actions } from '../app/store';
import { useUi } from '../app/uiState';
import { Button } from '../components/Button';
import { speak, stopSpeaking, useSpeech } from '../voice/speak';
import { Field, Section, Segmented } from './controls';

const KEY = secretName.apiKey('openai-api');

const SAMPLES: [string, string][] = [
  ['베트남어', 'Xin chào, rất vui được gặp bạn.'],
  ['영어', 'Nice to meet you. How have you been?'],
];

/**
 * 읽어 주기 설정 (ADR-050). 이 기기에만 저장한다.
 * 기본은 기기 음성. OpenAI는 음성 하나만 고르고, 실패하면 기기 음성으로 대신 읽는다.
 */
export function SpeechSettings() {
  const tts = useUi((s) => s.tts);
  const setTts = useUi((s) => s.setTts);
  const speaking = useSpeech((s) => s.status !== 'idle');
  return (
    <Section title="읽어 주기" hint="답변에서 글을 선택하고 [듣기]를 누르면 읽어 줘요. 베트남어·영어·한국어를 알아서 골라요. 이 기기에만 저장돼요.">
      <Field
        label="음성 엔진"
        hint={
          tts.engine === 'device'
            ? '기기에 내장된 음성으로 읽어요. 무료이고 인터넷이 없어도 돼요.'
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
      {tts.engine === 'openai' && (
        <>
          <Field label="OpenAI 음성" hint="고른 음성 하나만 써요. 같은 글을 다시 들으면 저장해 둔 소리를 재생해요.">
            <select
              value={tts.openaiVoice}
              onChange={(e) => setTts({ openaiVoice: e.target.value as OpenAIVoice })}
              aria-label="OpenAI 음성"
              className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-[14px] outline-none focus:border-accent"
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <OpenAIKeyField />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {SAMPLES.map(([label, text]) => (
          <Button key={label} size="sm" variant="soft" icon={<Volume2 size={14} />} onClick={() => speak(text)}>
            {label} 들어 보기
          </Button>
        ))}
        {speaking && (
          <Button size="sm" variant="ghost" icon={<Square size={13} />} onClick={stopSpeaking}>
            멈춤
          </Button>
        )}
      </div>
    </Section>
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
