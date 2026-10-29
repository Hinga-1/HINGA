import { MemoryEntry, MemorySearchFilter, MemoryStore, MemoryType } from '../types.ts';

/**
 * Fast, deterministic in-memory store for unit tests, offline sandbox & fallback.
 */
export class InMemoryStore implements MemoryStore {
  private entries: Map<string, MemoryEntry> = new Map();

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    const newEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.entries.set(id, newEntry);
    return newEntry;
  }

  async retrieve(id: string): Promise<MemoryEntry | null> {
    return this.entries.get(id) || null;
  }

  async search(filter: MemorySearchFilter): Promise<MemoryEntry[]> {
    let list = Array.from(this.entries.values());

    if (filter.type) {
      list = list.filter((e) => e.type === filter.type);
    }

    if (filter.tags && filter.tags.length > 0) {
      list = list.filter((e) => filter.tags!.some((t) => e.tags.includes(t)));
    }

    if (filter.query) {
      const q = filter.query.toLowerCase();
      list = list.filter((e) => e.key.toLowerCase().includes(q) || e.content.toLowerCase().includes(q));
    }

    list.sort((a, b) => b.importance - a.importance);

    if (filter.limit && filter.limit > 0) {
      list = list.slice(0, filter.limit);
    }

    return list;
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  async clear(type?: MemoryType): Promise<void> {
    if (!type) {
      this.entries.clear();
      return;
    }
    for (const [id, entry] of this.entries.entries()) {
      if (entry.type === type) {
        this.entries.delete(id);
      }
    }
  }

  get totalCount(): number {
    return this.entries.size;
  }
}
