import type { Provider, ProviderId } from '@tahlely/domain';
import { utcNow } from '@tahlely/domain';
import { PROVIDER_PRESETS, presetToProvider } from '@tahlely/ai';
import { services } from './bootstrap.js';

export { PROVIDER_PRESETS };

const KEY_SESSION = 'tahlely.v1.provider-keys';
const ACTIVE_MODEL_KEY = 'tahlely.v1.active-model';

/** Session-only key store: memory first, sessionStorage fallback. Never localStorage. */
const memoryKeys = new Map<string, string>();
const autoLoaded = new Set<string>();

/**
 * Dev-only auto-seed from Vite env (.env.local VITE_TAHLELY_*).
 * Gated on import.meta.env.DEV so production builds never embed keys.
 */
function devEnvKey(providerId: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      const value = import.meta.env[`VITE_TAHLELY_${providerId.toUpperCase()}_KEY`];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    // Non-Vite runtimes (tests) simply skip auto-seed.
  }
  return undefined;
}

/** Seed all dev-env keys into the session store (call once at startup). */
export function seedDevKeys(): string[] {
  const seeded: string[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (memoryKeys.has(preset.id) || getProviderKey(preset.id)) continue;
    const envKey = devEnvKey(preset.id);
    if (envKey) {
      memoryKeys.set(preset.id, envKey);
      autoLoaded.add(preset.id);
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem(`${KEY_SESSION}.${preset.id}`, envKey);
        }
      } catch {
        // ignore — memory store is authoritative.
      }
      seeded.push(preset.id);
    }
  }
  return seeded;
}

export function isAutoLoaded(providerId: string): boolean {
  return autoLoaded.has(providerId);
}

export function setProviderKey(providerId: string, key: string): void {
  const value = key.trim();
  if (!value) {
    memoryKeys.delete(providerId);
  } else {
    memoryKeys.set(providerId, value);
  }
  try {
    if (typeof sessionStorage !== 'undefined') {
      if (!value) sessionStorage.removeItem(`${KEY_SESSION}.${providerId}`);
      else sessionStorage.setItem(`${KEY_SESSION}.${providerId}`, value);
    }
  } catch {
    // Private mode — memory store is authoritative.
  }
}

export function getProviderKey(providerId: string): string | undefined {
  const mem = memoryKeys.get(providerId);
  if (mem) return mem;
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(`${KEY_SESSION}.${providerId}`) ?? undefined;
    }
  } catch {
    // ignore
  }
  return undefined;
}

export function hasProviderKey(providerId: string): boolean {
  return Boolean(getProviderKey(providerId));
}

export function getActiveModel(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(ACTIVE_MODEL_KEY) ?? 'mock/mock-reviewer';
    }
  } catch {
    // ignore
  }
  return 'mock/mock-reviewer';
}

export function setActiveModel(ref: string): void {
  try {
    localStorage.setItem(ACTIVE_MODEL_KEY, ref);
  } catch {
    // Non-persistent runtimes keep the default.
  }
}

/** Register all preset providers in the AI registry (idempotent). */
export function seedPresetProviders(): Provider[] {
  const now = utcNow();
  return PROVIDER_PRESETS.map((preset) => {
    const provider = { ...presetToProvider(preset, now), id: preset.id as ProviderId };
    // Re-create with current secrets so key rotations take effect.
    services.registry.getOrCreate(provider, { apiKey: getProviderKey(preset.id) });
    return provider;
  });
}

/** Live chat test through a preset provider with an explicit key. */
export async function testPresetProvider(providerId: string, apiKey: string): Promise<string> {
  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId);
  if (!preset) throw new Error(`Unknown provider ${providerId}.`);
  const now = utcNow();
  const provider: Provider = {
    ...(presetToProvider(preset, now) as Provider),
    id: providerId as ProviderId,
  };
  // Bypass the cached instance so the test always uses the typed key.
  const { OpenAiCompatibleProvider } = await import('@tahlely/ai');
  const instance = new OpenAiCompatibleProvider(provider, { apiKey: apiKey.trim() });
  const response = await instance.chat({
    model: preset.models[0] as string,
    messages: [{ role: 'user', content: 'Reply with exactly: tahlely-ok' }],
    maxTokens: 32,
  });
  return response.content.slice(0, 200) || '(empty reply — connection works)';
}
