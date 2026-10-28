import type { ID } from '@branch/core';
import { PresentAudience } from '../canvas/PresentAudience';

export interface PresentAudienceAppProps {
  sessionId: ID;
}

export function PresentAudienceApp({ sessionId }: PresentAudienceAppProps) {
  return <PresentAudience sessionId={sessionId} />;
}
