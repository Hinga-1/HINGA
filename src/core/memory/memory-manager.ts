import { MemoryEntry, MemoryScope, MemoryStore, MemoryType } from '../types.ts';

export class MemoryManager {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  // --- Working Memory ---
  async setWorkingContext(key: string, content: string, scope?: MemoryScope): Promise<MemoryEntry> {
    return this.store.store({
      type: 'working',
      key,
      content,
      importance: 5,
      tags: ['working_memory'],
      ...scope,
    });
  }

  async getWorkingContext(scope?: MemoryScope): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'working', limit: 20, ...scope });
  }

  async clearWorkingContext(scope?: MemoryScope): Promise<void> {
    return this.store.clear('working', scope);
  }

  // --- Episodic Memory ---
  async recordEpisode(action: string, result: string, tags: string[] = [], scope?: MemoryScope): Promise<MemoryEntry> {
    return this.store.store({
      type: 'episodic',
      key: `episode_${Date.now()}`,
      content: JSON.stringify({ action, result }),
      importance: 7,
      tags: ['episode', ...tags],
      ...scope,
    });
  }

  async getRecentEpisodes(limit: number = 10, scope?: MemoryScope): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'episodic', limit, ...scope });
  }

  // --- Semantic Memory ---
  async learnFact(topic: string, fact: string, importance: number = 8, tags: string[] = [], scope?: MemoryScope): Promise<MemoryEntry> {
    return this.store.store({
      type: 'semantic',
      key: topic,
      content: fact,
      importance,
      tags: ['semantic_fact', ...tags],
      ...scope,
    });
  }

  async findRelevantKnowledge(query: string, limit: number = 5, scope?: MemoryScope): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'semantic', query, limit, ...scope });
  }

  async getStoreStats(scope?: MemoryScope): Promise<{ type: string; total: number }> {
    const all = await this.store.search({ limit: 1000, ...scope });
    return {
      type: (this.store as any).constructor?.name || 'UnknownStore',
      total: all.length,
    };
  }
}
