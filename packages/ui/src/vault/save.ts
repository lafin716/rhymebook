import { createVaultItem, defaultVaultItemName, newId, VAULT_LIMITS, type ID, type VaultItemContent } from '@branch/core';
import { pushNotice } from '../app/sync';
import { actions, appStore } from '../app/store';

/** 답변이 속한 세션을 찾는다 (출처 기록용) */
function sourceOf(messageId: ID | undefined): { sessionId: ID; messageId: ID } | undefined {
  if (!messageId) return undefined;
  const { messages } = appStore.getState();
  for (const [sessionId, list] of Object.entries(messages)) {
    if (list.some((m) => m.id === messageId)) return { sessionId, messageId };
  }
  return undefined;
}

/**
 * 답변에서 나온 조각(글·이미지·음성)을 보관함 맨 위에 담는다 (ADR-055).
 * 너무 긴 글은 보관 한도에 맞춰 자른다
 */
export function saveToVault(item: VaultItemContent, messageId?: ID, name?: string) {
  const content: VaultItemContent = item.type === 'image' ? item : { ...item, text: item.text.slice(0, VAULT_LIMITS.text) };
  if (content.type !== 'image' && !content.text.trim()) return;
  const label = (name?.trim() || defaultVaultItemName(content)).replace(/\*+|`+|~~/g, '').replace(/^[#>\-\s]+/, '').trim() || '조각';
  actions().putVaultNode(createVaultItem(newId('v'), null, label, content, sourceOf(messageId), Date.now()));
  pushNotice('보관함에 담았어요.');
}
