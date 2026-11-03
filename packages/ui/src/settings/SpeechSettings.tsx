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
import { t, type MessageKey } from '../i18n';
import { speak, stopSpeaking, useSpeech } from '../voice/speak';
import { Field, Section, Segmented } from './controls';

const KEY = secretName.apiKey('openai-api');

/**
 * 샘플 문장은 그 언어 목소리를 들려 주는 용도라 언어 이름만 번역하고 문장은 원어 그대로 둔다.
 * 이름은 렌더 때 t()로 읽는다 (모듈 상수에 번역 문자열을 넣지 않는다).
 */
const SAMPLES: [SpeechLang, MessageKey, string][] = [
  ['vi', 'settings.speech.langVi', 'Xin chào, rất vui được gặp bạn.'],
  ['en', 'settings.speech.langEn', 'Nice to meet you. How have you been?'],
  ['ko', 'settings.speech.langKo', '만나서 반가워요. 잘 지냈어요?'],
];

const MODEL_LABEL_KEY: Record<OpenAITtsModel, MessageKey> = {
  'gpt-4o-mini-tts': 'settings.speech.modelMini',
  'gpt-4o-mini-tts-2025-12-15': 'settings.speech.modelMiniSnapshot',
  'tts-1': 'settings.speech.modelTts1',
  'tts-1-hd': 'settings.speech.modelTts1Hd',
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
    <Section title={t('settings.speech.title')} hint={t('settings.speech.hint')}>
      <Field
        label={t('settings.speech.engine')}
        hint={tts.engine === 'device' ? t('settings.speech.engineDeviceHint') : t('settings.speech.engineOpenaiHint')}
      >
        <Segmented<TtsEngine>
          value={tts.engine}
          options={[
            ['device', t('settings.speech.engineDevice')],
            ['openai', t('settings.speech.engineOpenai')],
          ]}
          onChange={(engine) => setTts({ engine })}
        />
      </Field>
      {tts.engine === 'openai' ? (
        <>
          <Field label={t('settings.speech.model')} hint={t('settings.speech.modelHint')}>
            <select
              value={tts.openaiModel}
              onChange={(e) => {
                const openaiModel = e.target.value as OpenAITtsModel;
                setTts({ openaiModel, openaiVoice: fitVoiceToModel(openaiModel, tts.openaiVoice) });
              }}
              aria-label={t('settings.speech.modelAria')}
              className={SELECT}
            >
              {OPENAI_TTS_MODELS.map((m) => (
                <option key={m} value={m}>
                  {t(MODEL_LABEL_KEY[m])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('settings.speech.openaiVoice')} hint={t('settings.speech.openaiVoiceHint')}>
            <select
              value={tts.openaiVoice}
              onChange={(e) => setTts({ openaiVoice: e.target.value as OpenAIVoice })}
              aria-label={t('settings.speech.openaiVoice')}
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
          {SAMPLES.map(([lang, labelKey, text]) => (
            <Button key={lang} size="sm" variant="soft" icon={<Volume2 size={14} />} onClick={() => speak(text, { lang })}>
              {t('settings.speech.listen', { label: t(labelKey) })}
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
      {t('settings.speech.stop')}
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
  const off = takes ? undefined : t('settings.speech.accentNote');
  return (
    <div className="rounded-lg border border-line">
      <div role="tablist" aria-label={t('settings.speech.langsAria')} className="flex border-b border-line px-1">
        {SAMPLES.map(([lang, labelKey]) => (
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
            {t(labelKey)}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-3 p-3">
        {tab === 'vi' && (
          <Field label={t('settings.speech.accent')} hint={off ?? t('settings.speech.viAccentHint')}>
            <Segmented<ViAccent>
              value={tts.viAccent}
              options={[
                ['north', t('settings.speech.viNorth')],
                ['south', t('settings.speech.viSouth')],
              ]}
              onChange={(viAccent) => setTts({ viAccent })}
            />
          </Field>
        )}
        {tab === 'en' && (
          <Field label={t('settings.speech.accent')} hint={off}>
            <Segmented<EnAccent>
              value={tts.enAccent}
              options={[
                ['us', t('settings.speech.enUs')],
                ['uk', t('settings.speech.enUk')],
              ]}
              onChange={(enAccent) => setTts({ enAccent })}
            />
          </Field>
        )}
        {tab === 'ko' && <p className="text-[12.5px] text-muted">{t('settings.speech.koNote')}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="soft" icon={<Volume2 size={14} />} onClick={() => speak(sample[2], { lang: tab })}>
            {t('settings.speech.listen', { label: t(sample[1]) })}
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
      label={t('settings.speech.keyLabel')}
      hint={
        saved
          ? t(remoteMode ? 'settings.speech.keySavedRemote' : 'settings.speech.keySavedLocal', { key: maskSecret(saved) })
          : t(secrets.kind === 'memory' ? 'settings.speech.keyMissingWeb' : 'settings.speech.keyMissing')
      }
    >
      {saved ? (
        <Button size="sm" variant="ghost" onClick={() => void remove()}>
          {t('settings.speech.keyRemove')}
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
            aria-label={t('settings.speech.keyLabel')}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 font-mono text-[13px] outline-none placeholder:font-sans focus:border-accent"
          />
          <Button type="submit" size="sm" variant="soft" disabled={!key.trim()}>
            {t('common.save')}
          </Button>
        </form>
      )}
    </Field>
  );
}
