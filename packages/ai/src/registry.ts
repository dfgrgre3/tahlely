import type { Model, Provider, ProviderKind } from '@tahlely/domain';
import { AppError } from '@tahlely/domain';
import { MockProvider } from './mock-provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible.js';
import type { AIProvider, ProviderFactory, ProviderSecrets } from './provider.js';

class OpenAiCompatibleFactory implements ProviderFactory {
  readonly kind = 'openai-compatible' as const;
  create(provider: Provider, secrets: ProviderSecrets): AIProvider {
    return new OpenAiCompatibleProvider(provider, secrets);
  }
}

class MockFactory implements ProviderFactory {
  readonly kind = 'local' as const;
  create(provider: Provider): AIProvider {
    return new MockProvider(provider.id);
  }
}

/**
 * Provider/model registry. Factories are keyed by ProviderKind so new vendors
 * plug in without touching callers; model ids are namespaced
 * "<providerId>/<model>" and resolve through here.
 */
export class ProviderRegistry {
  private readonly factories = new Map<ProviderKind, ProviderFactory>();
  private readonly instances = new Map<string, AIProvider>();
  private readonly models = new Map<string, Model>();

  constructor() {
    this.registerFactory(new OpenAiCompatibleFactory());
    this.registerFactory(new MockFactory());
  }

  registerFactory(factory: ProviderFactory): void {
    this.factories.set(factory.kind, factory);
  }

  getOrCreate(provider: Provider, secrets: ProviderSecrets = {}): AIProvider {
    const existing = this.instances.get(provider.id);
    if (existing) return existing;
    const factory = this.factories.get(provider.kind);
    if (!factory) {
      throw new AppError(`No AI factory for provider kind ${provider.kind}.`, {
        kind: 'ai-provider',
        code: 'AI_FACTORY_MISSING',
      });
    }
    const instance = factory.create(provider, secrets);
    this.instances.set(provider.id, instance);
    return instance;
  }

  registerModels(models: Model[]): void {
    for (const model of models) this.models.set(model.id, model);
  }

  resolveModel(modelId: string): Model | undefined {
    return this.models.get(modelId);
  }

  listModels(): Model[] {
    return [...this.models.values()];
  }

  clear(): void {
    this.instances.clear();
    this.models.clear();
  }
}
