interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

export class CacheManager {
  private memoryCache: Map<string, CacheEntry<any>> = new Map();
  private maxSize: number;
  private defaultTTL: number; // milliseconds

  constructor(maxSize: number = 1000, defaultTTL: number = 5 * 60 * 1000) { // 5 minutes default
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  set<T>(key: string, value: T, ttl?: number): void {
    // Clean up expired entries if cache is full
    if (this.memoryCache.size >= this.maxSize) {
      this.cleanup();
    }

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      hits: 0
    };

    this.memoryCache.set(key, entry);
  }

  get<T>(key: string): T | null {
    const entry = this.memoryCache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) {
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.memoryCache.delete(key);
      return null;
    }

    // Update hit count
    entry.hits++;
    
    return entry.value;
  }

  has(key: string): boolean {
    const entry = this.memoryCache.get(key);
    if (!entry) return false;
    
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.memoryCache.delete(key);
      return false;
    }
    
    return true;
  }

  delete(key: string): boolean {
    return this.memoryCache.delete(key);
  }

  clear(): void {
    this.memoryCache.clear();
  }

  cleanup(): void {
    const now = Date.now();
    let deletedCount = 0;
    
    // First pass: delete expired entries
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.memoryCache.delete(key);
        deletedCount++;
      }
    }

    // Second pass: if still full, delete least recently used
    if (this.memoryCache.size >= this.maxSize) {
      const entries = Array.from(this.memoryCache.entries());
      entries.sort((a, b) => {
        // Sort by hits (ascending) then by timestamp (oldest first)
        if (a[1].hits !== b[1].hits) {
          return a[1].hits - b[1].hits;
        }
        return a[1].timestamp - b[1].timestamp;
      });

      const toDelete = Math.min(entries.length - Math.floor(this.maxSize * 0.8), entries.length);
      for (let i = 0; i < toDelete; i++) {
        this.memoryCache.delete(entries[i][0]);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`Cache cleanup: removed ${deletedCount} entries`);
    }
  }

  stats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    averageHits: number;
    memoryUsage: number;
  } {
    let totalHits = 0;
    let activeEntries = 0;
    
    const now = Date.now();
    for (const entry of this.memoryCache.values()) {
      if (now - entry.timestamp <= entry.ttl) {
        totalHits += entry.hits;
        activeEntries++;
      }
    }

    const averageHits = activeEntries > 0 ? totalHits / activeEntries : 0;
    
    // Estimate memory usage (rough approximation)
    let memoryUsage = 0;
    for (const [key, entry] of this.memoryCache.entries()) {
      memoryUsage += key.length * 2; // UTF-16
      memoryUsage += JSON.stringify(entry.value).length * 2;
      memoryUsage += 32; // overhead for Map entry
    }

    return {
      size: activeEntries,
      maxSize: this.maxSize,
      hitRate: averageHits,
      averageHits,
      memoryUsage: Math.round(memoryUsage / 1024) // KB
    };
  }

  // Pattern-based caching for prompt analysis
  setPatternAnalysis(prompt: string, analysis: any): void {
    const key = `pattern:${this.hashPrompt(prompt)}`;
    this.set(key, analysis, 10 * 60 * 1000); // 10 minutes for pattern analysis
  }

  getPatternAnalysis(prompt: string): any | null {
    const key = `pattern:${this.hashPrompt(prompt)}`;
    return this.get(key);
  }

  setSemanticAnalysis(prompt: string, analysis: any): void {
    const key = `semantic:${this.hashPrompt(prompt)}`;
    this.set(key, analysis, 30 * 60 * 1000); // 30 minutes for semantic analysis
  }

  getSemanticAnalysis(prompt: string): any | null {
    const key = `semantic:${this.hashPrompt(prompt)}`;
    return this.get(key);
  }

  private hashPrompt(prompt: string): string {
    // Simple hash function for caching
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
      const char = prompt.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // Batch operations
  setMultiple<T>(entries: Array<{key: string, value: T, ttl?: number}>): void {
    for (const entry of entries) {
      this.set(entry.key, entry.value, entry.ttl);
    }
  }

  getMultiple<T>(keys: string[]): Map<string, T | null> {
    const results = new Map<string, T | null>();
    for (const key of keys) {
      results.set(key, this.get(key));
    }
    return results;
  }

  // Cache warming
  async warmCache(keys: string[], fetchFn: (key: string) => Promise<any>): Promise<void> {
    const promises = keys.map(async (key) => {
      if (!this.has(key)) {
        try {
          const value = await fetchFn(key);
          this.set(key, value);
        } catch (error) {
          console.error(`Failed to warm cache for key ${key}:`, error);
        }
      }
    });
    
    await Promise.all(promises);
  }
}