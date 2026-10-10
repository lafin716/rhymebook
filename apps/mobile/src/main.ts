import { createMobileApi } from './platform';

// 네이티브 API를 먼저 주입한 뒤 공유 UI를 불러온다 (ui는 import 시점에 window.branchMobile을 읽는다)
const api = createMobileApi();
if (api) window.branchMobile = api;

void import('@branch/ui/main');
