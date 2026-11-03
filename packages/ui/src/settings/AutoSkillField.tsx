import { useUi } from '../app/uiState';
import { t } from '../i18n';
import { Field, Segmented } from './controls';

/** 요청에 맞는 스킬 자동 사용 (이 기기에만 저장, IMP-21) */
export function AutoSkillField() {
  const on = useUi((s) => s.autoSkill);
  const set = useUi((s) => s.setAutoSkill);
  return (
    <Field
      label={t('settings.autoSkill.label')}
      hint={
        on
          ? t('settings.autoSkill.hintOn')
          : t('settings.autoSkill.hintOff')
      }
    >
      <Segmented
        value={on ? 'on' : 'off'}
        options={[
          ['on', t('settings.autoSkill.on')],
          ['off', t('settings.autoSkill.off')],
        ]}
        onChange={(v) => set(v === 'on')}
      />
    </Field>
  );
}
