import { t } from '../i18n';
import { X } from 'lucide-react';
import { IconButton } from './Button';
import { HostList } from './HostList';
import { Modal } from './Modal';

/** 프로필 고르기 (ADR-103): 이 기기 · 저장한 PC · PC 추가. 사이드바 아래 연결 표시에서 연다 */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Modal open={open} onClose={onClose} label={t('components.profile.title')} className="md:max-w-md">
      <div className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="flex-1 text-[16px] font-semibold">{t('components.profile.heading')}</h2>
        <IconButton label={t('components.profile.close')} onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-5">
        <p className="mb-3 text-[13px] text-fg-2">{t('components.profile.intro')}</p>
        <div className="flex justify-center">
          <HostList />
        </div>
      </div>
    </Modal>
  );
}
