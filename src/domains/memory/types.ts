/**
 * Memory Service Types
 *
 * Defines interfaces for the memory system that stores user facts
 * and provides CRUD operations.
 */

/**
 * A single fact about the user.
 * Facts are atomic, self-contained sentences like "Likes black coffee" or "Has a dog named Max".
 */
export interface UserFact {
  /** Unique identifier for this fact */
  id: string;

  /** Phone number of the user this fact belongs to */
  phoneNumber: string;

  /** The fact as a concise, atomic sentence */
  fact: string;

  /** Optional category: preferences, health, relationships, work, interests, etc. */
  category?: string;

  /** Confidence score from 0.0-1.0 representing evidence strength */
  confidence: number;

  /** Whether this fact was explicitly stated or inferred */
  sourceType: 'explicit' | 'inferred';

  /** Optional evidence snippet supporting the fact */
  evidence?: string;

  /** Unix timestamp (milliseconds) when this fact was last reinforced */
  lastReinforcedAt?: number;

  /** Unix timestamp (milliseconds) when this fact was extracted */
  extractedAt: number;

  // Phase 2: embedding?: Float32Array;
}

/**
 * Interface for memory storage operations.
 * Implementations should provide persistent storage for user facts.
 *
 * Note: Methods return Promises for interface flexibility, but the current
 * SQLite implementation (better-sqlite3) is synchronous. The async signature
 * allows swapping to an async backend without changing callers.
 */
export interface MemoryStore {
  /**
   * Get all facts for a user, ordered by extraction time (newest first).
   */
  getFacts(phoneNumber: string): Promise<UserFact[]>;

  /**
   * Get all facts across all users, ordered by extraction time (newest first).
   * Used by admin tools.
   */
  getAllFacts(): Promise<UserFact[]>;

  /**
   * Add a new fact for a user.
   * @returns The created fact with generated ID
   */
  addFact(fact: Omit<UserFact, 'id'>): Promise<UserFact>;

  /**
   * Update an existing fact.
   * @param id The fact ID to update
   * @param updates Fields to update (partial)
   */
  updateFact(id: string, updates: Partial<Omit<UserFact, 'id' | 'phoneNumber'>>): Promise<void>;

  /**
   * Delete a fact by ID.
   */
  deleteFact(id: string): Promise<void>;

  /**
   * Delete stale low-confidence observations.
   * Returns number of rows deleted.
   */
  deleteStaleObservations(): Promise<number>;
}
