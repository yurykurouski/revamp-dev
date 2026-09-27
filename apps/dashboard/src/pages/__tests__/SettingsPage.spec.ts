/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material';
import { findLlmProvider, type ILlmProvidersResponse } from '@revamp/shared-types';
import i18n from '../../i18n/index.js';
import { en } from '../../i18n/locales/en.js';
import { pl } from '../../i18n/locales/pl.js';
import { apiClient } from '../../api/client.js';
import { getTheme } from '../../theme/theme.js';
import { useThemeStore } from '../../store/useThemeStore.js';
import { useLanguageStore } from '../../store/useLanguageStore.js';
import { useLlmChoiceStore } from '../../store/useLlmChoiceStore.js';
import { SettingsPage } from '../SettingsPage.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDERS: ILlmProvidersResponse = {
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-5',
  workersOnline: true,
  providers: [
    {
      id: 'anthropic',
      label: 'Anthropic API',
      defaultModel: 'claude-sonnet-5',
      models: [
        { id: 'claude-opus-5', label: 'Claude Opus 5' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      ],
      local: false,
      devOnly: false,
      available: true,
    },
    {
      id: 'openai',
      label: 'OpenAI',
      defaultModel: 'gpt-4o',
      models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
      local: false,
      devOnly: false,
      available: false,
      reason: 'missing_api_key',
    },
  ],
};

describe('SettingsPage (REV-76)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.spyOn(apiClient, 'getLlmProviders').mockResolvedValue(PROVIDERS);
    useThemeStore.getState().setTheme('dark');
    useLanguageStore.getState().setLanguage('en');
    useLlmChoiceStore.getState().resetToDefault();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    useLanguageStore.getState().setLanguage('en');
    useLlmChoiceStore.getState().resetToDefault();
    vi.restoreAllMocks();
  });

  const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));

  const mount = async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(ThemeProvider, { theme: getTheme('dark', 'en') }, React.createElement(SettingsPage)),
        ),
      );
    });
    await flush();
  };

  const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === text)!;

  /** Opens an MUI Select and picks the option with this value */
  const pick = async (combobox: Element, value: string) => {
    await act(async () => {
      combobox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    });
    const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`);
    expect(option, `option ${value}`).not.toBeNull();
    await act(async () => option!.click());
    await flush();
  };

  const comboboxFor = (labelId: string) => document.querySelector(`[role="combobox"][aria-labelledby~="${labelId}"]`)!;

  it('renders the Appearance and AI generation sections in one column', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe(en.settings.title);
    const sections = [...document.querySelectorAll('section')].map((s) => s.getAttribute('aria-label'));
    expect(sections).toEqual([en.settings.appearance, en.settings.aiGeneration]);
  });

  it('switches the theme through the theme store', async () => {
    await mount();
    expect(button(en.settings.dark).getAttribute('aria-pressed')).toBe('true');

    await act(async () => button(en.settings.light).click());
    expect(useThemeStore.getState().mode).toBe('light');
    expect(button(en.settings.light).getAttribute('aria-pressed')).toBe('true');

    await act(async () => button(en.settings.dark).click());
    expect(useThemeStore.getState().mode).toBe('dark');
  });

  it('switches the interface language through the language store', async () => {
    await mount();
    await pick(comboboxFor('settings-language-label'), 'pl');

    expect(useLanguageStore.getState().language).toBe('pl');
    expect(i18n.language).toBe('pl');
    expect(document.querySelector('h1')!.textContent).toBe(pl.settings.title);
  });

  it('sets the default LLM provider and model through the LLM choice store', async () => {
    await mount();

    // A new provider starts from its catalog default model
    await pick(comboboxFor('llm-provider-label'), 'anthropic');
    expect(useLlmChoiceStore.getState()).toMatchObject({
      provider: 'anthropic',
      model: findLlmProvider('anthropic')!.defaultModel,
    });

    await pick(comboboxFor('llm-model-label'), 'claude-sonnet-5');
    expect(useLlmChoiceStore.getState()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5' });

    await pick(comboboxFor('llm-provider-label'), '__default__');
    expect(useLlmChoiceStore.getState()).toMatchObject({ provider: null, model: null });
  });

  it('lists what the workers report for each provider', async () => {
    await mount();
    const chips = [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent);
    expect(chips).toContain(en.settings.providerReady.replace('{{name}}', 'Anthropic API'));
    expect(chips).toContain(
      en.settings.providerUnavailable.replace('{{name}}', 'OpenAI').replace('{{reason}}', en.llm.reasons.missing_api_key),
    );
  });

  it('says the workers are offline when none has reported in', async () => {
    vi.mocked(apiClient.getLlmProviders).mockResolvedValue({ workersOnline: false, providers: [] });
    await mount();
    const chips = [...document.querySelectorAll('.MuiChip-label')].map((c) => c.textContent);
    expect(chips).toEqual([en.llm.reasons.workers_offline]);
    // The Workers row says it once; the model picker does not repeat it
    expect(document.body.textContent).not.toContain(en.llm.workersOffline);
  });
});
