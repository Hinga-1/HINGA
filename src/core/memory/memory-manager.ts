import { MemoryEntry, MemoryStore, MemoryType } from '../types.ts';

export class MemoryManager {
  private store: MemoryStore;

  constructor(store: MemoryStore) {
    this.store = store;
  }

  // --- Working Memory ---
  async setWorkingContext(key: string, content: string): Promise<MemoryEntry> {
    return this.store.store({
      type: 'working',
      key,
      content,
      importance: 5,
      tags: ['working_memory'],
    });
  }

  async getWorkingContext(): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'working', limit: 20 });
  }

  async clearWorkingContext(): Promise<void> {
    return this.store.clear('working');
  }

  // --- Episodic Memory ---
  async recordEpisode(action: string, result: string, tags: string[] = []): Promise<MemoryEntry> {
    return this.store.store({
      type: 'episodic',
      key: `episode_${Date.now()}`,
      content: JSON.stringify({ action, result }),
      importance: 7,
      tags: ['episode', ...tags],
    });
  }

  async getRecentEpisodes(limit: number = 10): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'episodic', limit });
  }

  // --- Semantic Memory ---
  async learnFact(topic: string, fact: string, importance: number = 8, tags: string[] = []): Promise<MemoryEntry> {
    return this.store.store({
      type: 'semantic',
      key: topic,
      content: fact,
      importance,
      tags: ['semantic_fact', ...tags],
    });
  }

  async findRelevantKnowledge(query: string, limit: number = 5): Promise<MemoryEntry[]> {
    return this.store.search({ type: 'semantic', query, limit });
  }

  async getStoreStats(): Promise<{ type: string; total: number }> {
    const all = await this.store.search({ limit: 1000 });
    return {
      type: (this.store as any).constructor?.name || 'UnknownStore',
      total: all.length,
    };
  }
}
