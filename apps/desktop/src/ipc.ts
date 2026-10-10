/** main ↔ preload 공용 채널 이름 (렌더러 API 모양은 @branch/core의 DesktopApi) */
export const CH = {
  bridgeSend: 'bridge:send',
  bridgeMsg: 'bridge:msg',
  secretPersistent: 'secrets:persistent',
  secretGet: 'secrets:get',
  secretSet: 'secrets:set',
  secretDelete: 'secrets:delete',
} as const;
