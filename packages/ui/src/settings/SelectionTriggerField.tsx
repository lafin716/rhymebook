import { caps } from '../app/capabilities';
import { useUi } from '../app/uiState';
import { t } from '../i18n';
import { Field, Segmented } from './controls';

/** 드래그 메뉴 표시 방식 (PC·웹 전용, 이 기기에만 저장). 모바일 앱은 항상 자동 */
export function SelectionTriggerField() {
  const value = useUi((s) => s.selectionTrigger);
  const set = useUi((s) => s.setSelectionTrigger);
  if (caps.kind === 'mobile') return null;
  return (
    <Field
      label={t('settings.selectionTrigger.label')}
      hint={
        value === 'auto'
          ? t('settings.selectionTrigger.hintAuto')
          : t('settings.selectionTrigger.hintContextmenu')
      }
    >
      <Segmented
        value={value}
        options={[
          ['auto', t('settings.selectionTrigger.auto')],
          ['contextmenu', t('settings.selectionTrigger.contextmenu')],
        ]}
        onChange={set}
      />
    </Field>
  );
}
