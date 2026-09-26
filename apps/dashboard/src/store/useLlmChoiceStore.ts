import { create } from 'zustand';
import { LlmProviderId, findLlmProvider } from '@revamp/shared-types';

/** The operator's provider/model for MVP generation; null means the server default (REV-32) */
export interface LlmChoice {
  provider: LlmProviderId | null;
  model: string | null;
}

interface LlmChoiceState extends LlmChoice {
  setProvider: (provider: LlmProviderId | null) => void;
  setModel: (model: string) => void;
  resetToDefault: () => void;
}

export const LLM_CHOICE_STORAGE_KEY = 'revamp_llm_choice';

const SERVER_DEFAULT: LlmChoice = { provider: null, model: null };

/** Keeps a stored choice only while the catalog still has that provider and model */
export function sanitizeLlmChoice(value: unknown): LlmChoice {
  if (!value || typeof value !== 'object') return SERVER_DEFAULT;
  const { provider, model } = value as Partial<LlmChoice>;
  const option = findLlmProvider(provider ?? undefined);
  if (!option) return SERVER_DEFAULT;
  return {
    provider: option.id,
    model: option.models.some((m) => m.id === model) ? (model as string) : option.defaultModel,
  };
}

function getInitialChoice(): LlmChoice {
  try {
    const raw = localStorage.getItem(LLM_CHOICE_STORAGE_KEY);
    return raw ? sanitizeLlmChoice(JSON.parse(raw)) : SERVER_DEFAULT;
  } catch {
    // Missing or unreadable storage: use the server default
    return SERVER_DEFAULT;
  }
}

function persist(choice: LlmChoice): LlmChoice {
  try {
    if (choice.provider) localStorage.setItem(LLM_CHOICE_STORAGE_KEY, JSON.stringify(choice));
    else localStorage.removeItem(LLM_CHOICE_STORAGE_KEY);
  } catch {
    // Ignore in non-browser env
  }
  return choice;
}

export const useLlmChoiceStore = create<LlmChoiceState>((set, get) => ({
  ...getInitialChoice(),

  // Switching provider starts from that provider's default model
  setProvider: (provider) =>
    set(persist(provider ? sanitizeLlmChoice({ provider, model: null }) : SERVER_DEFAULT)),
  setModel: (model) => {
    const { provider } = get();
    if (!provider) return;
    set(persist(sanitizeLlmChoice({ provider, model })));
  },
  resetToDefault: () => set(persist(SERVER_DEFAULT)),
}));
