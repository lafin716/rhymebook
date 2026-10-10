import type { MobileApi } from '@branch/core';

declare global {
  interface Window {
    branchMobile?: MobileApi;
  }
}
