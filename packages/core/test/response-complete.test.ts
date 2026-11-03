import { describe, expect, it, vi } from 'vitest';
import { createAppStore, type ResponseComplete } from '../src/store';
import { ProviderRegistry, type StreamRequest, type StreamEvent } from '../src/provider';

function fixture(stream: (req: StreamRequest) => AsyncIterable<StreamEvent>, complete = vi.fn<(event: ResponseComplete) => void>()) {
  const registry = new ProviderRegistry().register({ id: 'mock', label: 'Mock', available: async () => ({ status: 'ready' }), stream });
  const store = createAppStore({ registry, onResponseComplete: complete });
  store.getState().updateSettings({ defaultProviderId: 'mock' });
  const id = store.getState().newRootSession() as string;
  return { store, id, complete };
}
const idle = async (store: ReturnType<typeof createAppStore>) => {
  await vi.waitFor(() => expect(Object.keys(store.getState().streaming)).toHaveLength(0));
};

describe('successful response completion hook', () => {
  it('reports one finished response with its original user question after streaming is cleared', async () => {
    const { store, id, complete } = fixture(async function* () { yield { type: 'delta', text: 'done' }; yield { type: 'done' }; });
    const userMessageId = store.getState().sendMessage(id, 'hello');
    await idle(store);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id, userMessageId, content: 'done', scheduleRun: false }));
    expect(store.getState().messages[id]![1]!.status).toBe('done');
  });
  it('does not notify on provider error or load, and notifies on successful retry', async () => {
    let fail = true;
    const { store, id, complete } = fixture(async function* () {
      if (fail) yield { type: 'error', error: { code: 'offline', message: 'offline', retryable: true } };
      else { yield { type: 'delta', text: 'retry' }; yield { type: 'done' }; }
    });
    store.getState().sendMessage(id, 'hi'); await idle(store); expect(complete).not.toHaveBeenCalled();
    store.getState().load({ messages: store.getState().messages }); expect(complete).not.toHaveBeenCalled();
    fail = false; store.getState().retry(id); await idle(store); expect(complete).toHaveBeenCalledTimes(1);
  });
  it('does not notify when generation is aborted', async () => {
    const { store, id, complete } = fixture(async function* (req) {
      await new Promise<void>((resolve) => req.signal!.addEventListener('abort', () => resolve(), { once: true }));
      yield { type: 'error', error: { code: 'aborted', message: '', retryable: false } };
    });
    store.getState().sendMessage(id, 'hi'); store.getState().stopStream(id); await idle(store);
    expect(complete).not.toHaveBeenCalled();
  });
  it('includes scheduling clock only for manual scheduling turns, preserving provenance', async () => {
    const requests: StreamRequest[] = [];
    const { store, id, complete } = fixture(async function* (req) {
      if (req.purpose === 'chat') requests.push(req);
      yield { type: 'done' };
    });
    store.getState().sendMessage(id, '매일 오전 9시에 퀴즈를 내줘'); await idle(store);
    expect(requests[0]?.system).toContain('```schedule');
    store.getState().sendMessage(id, '매일 오전 9시에 퀴즈를 내줘', undefined, { scheduleRun: true }); await idle(store);
    expect(requests[1]?.system).not.toContain('## 예약 요청');
    expect(complete.mock.calls[1]?.[0].scheduleRun).toBe(true);
  });
  it('isolates side-effect failures from the completed answer', async () => {
    const { store, id } = fixture(async function* () { yield { type: 'done' }; }, vi.fn(() => { throw new Error('notification failed'); }));
    store.getState().sendMessage(id, 'hi'); await idle(store);
    expect(store.getState().messages[id]![1]?.status).toBe('done');
  });
});
