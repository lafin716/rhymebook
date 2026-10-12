import { caps } from '../app/capabilities';
import { useUi } from '../app/uiState';
import { Field, Segmented } from './controls';

/** 드래그 메뉴 표시 방식 (PC·웹 전용, 이 기기에만 저장). 모바일 앱은 항상 자동 */
export function SelectionTriggerField() {
  const value = useUi((s) => s.selectionTrigger);
  const set = useUi((s) => s.setSelectionTrigger);
  if (caps.kind === 'mobile') return null;
  return (
    <Field
      label="텍스트 드래그 메뉴"
      hint={
        value === 'auto'
          ? '답변 속 텍스트를 드래그하면 가지·서식 메뉴가 바로 떠요. 좁은 화면(모바일 폭)에서는 항상 자동이에요.'
          : '드래그한 뒤 오른쪽 클릭하면 메뉴가 떠요. 그냥 드래그하면 복사 등 기본 동작만 해요.'
      }
    >
      <Segmented
        value={value}
        options={[
          ['auto', '드래그하면 자동'],
          ['contextmenu', '우클릭으로 열기'],
        ]}
        onChange={set}
      />
    </Field>
  );
}
