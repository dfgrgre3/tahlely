import type { AppEvent, AppEventHandler, AppEventName } from '@tahlely/domain';
import { newId, utcNow } from '@tahlely/domain';

/**
 * Typed in-process event bus. The only coupling between modules:
 * publishers emit AppEvents, subscribers react — no direct imports.
 * Handler failures are isolated and reported, never thrown into publishers.
 */
export class EventBus {
  private readonly handlers = new Map<AppEventName, Set<AppEventHandler<AppEventName>>>();
  private readonly errors: unknown[] = [];

  on<Name extends AppEventName>(name: Name, handler: AppEventHandler<Name>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    const wrapped = handler as AppEventHandler<AppEventName>;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  once<Name extends AppEventName>(name: Name, handler: AppEventHandler<Name>): () => void {
    const off = this.on(name, ((event: AppEvent<Name>) => {
      off();
      return handler(event);
    }) as AppEventHandler<Name>);
    return off;
  }

  async emit<Name extends AppEventName>(
    name: Name,
    payload: AppEvent<Name>['payload'],
    projectId?: AppEvent<Name>['projectId'],
  ): Promise<AppEvent<Name>> {
    const event: AppEvent<Name> = {
      id: newId('evt'),
      name,
      at: utcNow(),
      projectId,
      payload,
    };
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return event;
    for (const handler of [...set]) {
      try {
        await handler(event as AppEvent<AppEventName>);
      } catch (error) {
        this.errors.push(error);
      }
    }
    return event;
  }

  listenerCount(name: AppEventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  /** Handler errors swallowed during emit (publishers stay decoupled). */
  drainErrors(): unknown[] {
    return this.errors.splice(0, this.errors.length);
  }
}
