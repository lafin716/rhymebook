import { useUi } from '../app/uiState';
import { Field, Segmented } from './controls';

/** 요청에 맞는 스킬 자동 사용 (이 기기에만 저장, IMP-21) */
export function AutoSkillField() {
  const on = useUi((s) => s.autoSkill);
  const set = useUi((s) => s.setAutoSkill);
  return (
    <Field
      label="요청에 맞는 스킬 자동 사용"
      hint={
        on
          ? '"퀴즈 내 줘", "발음 들려줘"처럼 스킬 용도에 맞는 요청을 쓰면 입력창에 자동 스킬이 붙어요. 칩의 ✕로 이번 질문만 뺄 수 있어요.'
          : '스킬은 / 명령이나 + 메뉴로 고를 때만 써요.'
      }
    >
      <Segmented
        value={on ? 'on' : 'off'}
        options={[
          ['on', '자동으로 쓰기'],
          ['off', '직접 고를 때만'],
        ]}
        onChange={(v) => set(v === 'on')}
      />
    </Field>
  );
}
