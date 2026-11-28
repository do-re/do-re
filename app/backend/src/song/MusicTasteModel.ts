import type { ListeningEvent, Song } from '../model/types';
import { TasteVector } from '../model/vectors';
import { type Item, type Key, type Table, updateItem } from '../store/Table';
import type { SongCatalog } from './SongCatalog';

const tasteKey = (userId: string): Key => ({ pk: `USER#${userId}`, sk: 'TASTE' });

/**
 * MusicTasteModel: stores each user's latest 100 songs and maintains each user's 7-long
 * Taste Vector.
 * Resides on: server. Communicates with: SongController.
 *
 * Stored state: USER#<id> / TASTE with vector (7 numbers), history (song IDs, most recent
 * first) and undos (for each of the last UNDO_LIMIT listens, the vector before it and the
 * history entry it pushed out, oldest first). A song's Audio Features are found through the song catalog by its ID, so they
 * always accompany the song (R-HOME-12).
 *
 * Abstraction function: AF(table) = for each user with a TASTE item, their Taste Vector and
 *   the list of songs they most recently listened to; every other user has the neutral
 *   vector and an empty history.
 * Rep invariant: vector satisfies the TasteVector rep invariant (7 finite numbers in
 *   [0, 1]); history.length <= HISTORY_SIZE; undos.length <= UNDO_LIMIT and every stored
 *   earlier vector also satisfies the TasteVector rep invariant (so undo keeps the bound).
 *
 * Proof that the vector cannot "explode" (testing.md proof 2, OPEN-15): by induction on the
 * number of listens. The initial vector is neutral, so in [0, 1]^7. Each update sets every
 * entry to clamp(t + w * (f - t), 0, 1), which is in [0, 1] whatever t, w and f are. Even
 * without the clamp, |w| <= MAX_STEP < 1 and t, f in [0, 1] give a result in
 * [-MAX_STEP, 1 + MAX_STEP]. test/taste.test.ts checks the property on random sequences.
 *
 * Concurrency: recordListen and undoLastListen are read-modify-writes of one item through updateItem, so
 * concurrent listens by one user (two tabs, or a retried request, on any Lambda instances)
 * are each folded into the vector exactly once, one after another.
 */
export class MusicTasteModel {
  static readonly HISTORY_SIZE = 100;
  /** Largest fraction of the distance a single listen may move the Taste Vector. */
  static readonly MAX_STEP = 0.2;
  /**
   * An instant skip moves taste by this fraction of MAX_STEP. Skips are weaker than likes:
   * people skip far more songs than they like, and a skip says less about taste. The value is
   * the one the frontend demo was tuned with (notes-for-felix F-12).
   */
  static readonly SKIP_STRENGTH = 0.25;
  /** How many listens in a row can be undone. */
  static readonly UNDO_LIMIT = 10;

  constructor(
    private readonly table: Table,
    private readonly catalog: SongCatalog,
  ) {}

  /**
   * Records one listen and folds it into the user's Taste Vector.
   * Satisfies: R-HOME-12, R-HOME-17.
   *
   * Requires: userId belongs to an existing account; event satisfies its rep invariant.
   * Effects: event.song is added as the most recent entry of the user's history; if the
   *          history then exceeds HISTORY_SIZE, the oldest entry is removed. The listen can
   *          be undone until UNDO_LIMIT later listens have been recorded. With
   *          w = computeWeight(event), f = the song's Audio Features and t = the old Taste
   *          Vector, each entry of the new vector is clamp(t[i] + w * (f[i] - t[i]), 0, 1):
   *          toward liked songs, away from skipped ones (OPEN-15).
   */
  async recordListen(userId: string, event: ListeningEvent): Promise<void> {
    const w = this.computeWeight(event);
    const f = event.song.features.values();
    await updateItem(this.table, tasteKey(userId), (current) => {
      const t = vectorOf(current).values();
      const vector = new TasteVector(t.map((ti, i) => Math.min(1, Math.max(0, ti + w * (f[i]! - ti)))));
      const before = historyOf(current);
      const history = [event.song.id, ...before].slice(0, MusicTasteModel.HISTORY_SIZE);
      const dropped = before.length === MusicTasteModel.HISTORY_SIZE ? before.at(-1)! : null;
      const undos = [...undosOf(current), { vector: t, dropped }].slice(-MusicTasteModel.UNDO_LIMIT);
      return { attrs: { vector: vector.values(), history, undos }, result: undefined };
    });
  }

  /**
   * Reverses the user's latest listen, for the undo button. Added to stubs v2 (api.md Q-14).
   *
   * Requires: userId belongs to an existing account.
   * Effects: if a listen can be undone, the Taste Vector and history return to what they
   *          were before it; otherwise nothing changes.
   * @returns true iff a listen was undone
   */
  async undoLastListen(userId: string): Promise<boolean> {
    return updateItem(this.table, tasteKey(userId), (current) => {
      const undos = undosOf(current);
      const last = undos.at(-1);
      if (last === undefined) {
        return { result: false };
      }
      const history = historyOf(current).slice(1);
      if (last.dropped !== null) {
        history.push(last.dropped);
      }
      return { attrs: { vector: last.vector, history, undos: undos.slice(0, -1) }, result: true };
    });
  }

  /**
   * Computes how strongly one listen should change a Taste Vector.
   *
   * Requires: event satisfies its rep invariant.
   * Effects: none.
   * @returns a weight w with -MAX_STEP <= w <= MAX_STEP that increases with the fraction p
   *          of the song listened to: MAX_STEP * (1 + p) / 2 for LIKE (so w > 0), and
   *          -MAX_STEP * SKIP_STRENGTH * (1 - p) for SKIP (so w <= 0: an instant skip pushes
   *          away hardest, and skipping at the very end does nothing)
   */
  computeWeight(event: ListeningEvent): number {
    const p = Math.min(1, Math.max(0, event.secondsListened / event.song.durationSeconds));
    if (event.feedback === 'LIKE') {
      return (MusicTasteModel.MAX_STEP * (1 + p)) / 2;
    }
    return p === 1 ? 0 : -MusicTasteModel.MAX_STEP * MusicTasteModel.SKIP_STRENGTH * (1 - p);
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none.
   * @returns the user's listened songs, most recent first, at most HISTORY_SIZE long
   *          (songs the app no longer knows are left out)
   */
  async getRecentSongs(userId: string): Promise<Song[]> {
    const ids = historyOf(await this.table.get(tasteKey(userId)));
    const songs = await Promise.all(ids.map((id) => this.catalog.get(id)));
    return songs.filter((song) => song !== undefined);
  }

  /**
   * Requires: userId belongs to an existing account.
   * Effects: none. (Stubs v2 created the neutral vector here; it is now simply the value of
   *          a user with no stored vector, so there is nothing to write.)
   * @returns the user's current Taste Vector; every entry is 0.5 if they have no history
   */
  async getTasteVector(userId: string): Promise<TasteVector> {
    return vectorOf(await this.table.get(tasteKey(userId)));
  }
}

function vectorOf(item: Item | undefined): TasteVector {
  return item === undefined ? TasteVector.neutral() : new TasteVector(item.vector as number[]);
}

function historyOf(item: Item | undefined): string[] {
  return item === undefined ? [] : (item.history as string[]);
}

function undosOf(item: Item | undefined): { vector: number[]; dropped: string | null }[] {
  return (item?.undos ?? []) as { vector: number[]; dropped: string | null }[];
}
