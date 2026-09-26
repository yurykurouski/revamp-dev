import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LLM_CHOICE_STORAGE_KEY, sanitizeLlmChoice } from '../useLlmChoiceStore.js';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void data.set(key, value)),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
};

const loadStore = async () => {
  vi.resetModules();
  return (await import('../useLlmChoiceStore.js')).useLlmChoiceStore;
};

describe('useLlmChoiceStore (REV-32)', () => {
  let storage: ReturnType<typeof memoryStorage>;

  beforeEach(() => {
    storage = memoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on the server default', async () => {
    const store = await loadStore();
    expect(store.getState()).toMatchObject({ provider: null, model: null });
  });

  it("switches provider to that provider's default model and remembers it", async () => {
    const store = await loadStore();

    store.getState().setProvider('claude-cli');

    expect(store.getState()).toMatchObject({ provider: 'claude-cli', model: 'sonnet' });
    expect(JSON.parse(storage.data.get(LLM_CHOICE_STORAGE_KEY)!)).toEqual({ provider: 'claude-cli', model: 'sonnet' });
  });

  it('changes the model within the provider and ignores models it does not offer', async () => {
    const store = await loadStore();
    store.getState().setProvider('anthropic');

    store.getState().setModel('claude-haiku-4-5');
    expect(store.getState().model).toBe('claude-haiku-4-5');

    store.getState().setModel('gpt-4o');
    expect(store.getState().model).toBe('claude-opus-5');
  });

  it('ignores a model change while on the server default', async () => {
    const store = await loadStore();
    store.getState().setModel('opus');
    expect(store.getState()).toMatchObject({ provider: null, model: null });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('resets to the server default and forgets the choice', async () => {
    const store = await loadStore();
    store.getState().setProvider('openai');

    store.getState().resetToDefault();

    expect(store.getState()).toMatchObject({ provider: null, model: null });
    expect(storage.data.has(LLM_CHOICE_STORAGE_KEY)).toBe(false);
  });

  it("restores the operator's last choice on load", async () => {
    storage = memoryStorage({ [LLM_CHOICE_STORAGE_KEY]: JSON.stringify({ provider: 'claude-cli', model: 'opus' }) });
    vi.stubGlobal('localStorage', storage);

    const store = await loadStore();

    expect(store.getState()).toMatchObject({ provider: 'claude-cli', model: 'opus' });
  });

  it('falls back to the server default for corrupt storage or storage that throws', async () => {
    vi.stubGlobal('localStorage', memoryStorage({ [LLM_CHOICE_STORAGE_KEY]: '{not json' }));
    expect((await loadStore()).getState().provider).toBeNull();

    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    expect((await loadStore()).getState().provider).toBeNull();
  });

  describe('sanitizeLlmChoice', () => {
    it('drops unknown providers and replaces unknown models with the default', () => {
      expect(sanitizeLlmChoice({ provider: 'llama', model: 'x' })).toEqual({ provider: null, model: null });
      expect(sanitizeLlmChoice({ provider: 'gemini', model: 'retired-model' })).toEqual({
        provider: 'gemini',
        model: 'gemini-1.5-pro',
      });
      expect(sanitizeLlmChoice(null)).toEqual({ provider: null, model: null });
      expect(sanitizeLlmChoice('anthropic')).toEqual({ provider: null, model: null });
    });
  });
});
