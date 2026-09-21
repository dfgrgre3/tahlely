/**
 * Curated provider/model presets (no secrets here).
 * Keys are resolved at runtime from env / OS keychain via credentialRef.
 * All endpoints speak OpenAI-compatible /chat/completions.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  extraHeaders?: Record<string, string>;
  models: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'atria',
    name: 'Atria ASI',
    baseUrl: 'https://api.atria-asi.ai/v1',
    envKey: 'TAHLELY_ATRIA_KEY',
    models: ['Atria-Dawn-Preview'],
  },
  {
    id: 'agentrouter',
    name: 'AgentRouter',
    baseUrl: 'https://agentrouter.org/v1',
    envKey: 'TAHLELY_AGENTROUTER_KEY',
    models: ['claude-opus-5', 'deepseek-v4-flash', 'gpt-6-astra', 'gpt-5.6-sol'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/v1',
    envKey: 'TAHLELY_OPENROUTER_KEY',
    extraHeaders: { 'HTTP-Referer': 'https://tahlely.local', 'X-Title': 'Tahlely' },
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'openrouter/free',
      'google/gemma-4-31b-it:free',
      'z-ai/glm-5.2:free',
      'qwen/qwen3.8-27b:free',
      'poolside/laguna-s-2.1:free',
    ],
  },
  {
    id: 'nvidia',
    name: 'NVIDIA Integrate',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envKey: 'TAHLELY_NVIDIA_KEY',
    models: [
      'moonshotai/kimi-k3',
      'z-ai/glm-5.3',
      'deepseek-ai/deepseek-v4-flash-0731',
      'z-ai/glm-5.3-flash',
    ],
  },
];

/** Build domain Provider objects from presets (timestamps filled by caller/store). */
export function presetToProvider(preset: ProviderPreset, now: string): {
  id: string;
  name: string;
  kind: 'openai-compatible';
  baseUrl: string;
  extraHeaders?: Record<string, string>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: preset.id,
    name: preset.name,
    kind: 'openai-compatible',
    baseUrl: preset.baseUrl,
    ...(preset.extraHeaders ? { extraHeaders: preset.extraHeaders } : {}),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}
