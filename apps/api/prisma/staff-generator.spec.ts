import { COUNTRIES } from '@gpp/shared';
import { DEFAULT_STAFF, plannedCounts, rng } from './staff-generator';
import { NAME_POOLS } from './demo-names';

describe('synthetic staff plan', () => {
  it('gives every country between 500 and 1,000 people', () => {
    const counts = plannedCounts(DEFAULT_STAFF);
    expect(Object.keys(counts).sort()).toEqual(COUNTRIES.map((c) => c.code).sort());
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThanOrEqual(500);
      expect(n).toBeLessThanOrEqual(1000);
    }
  });

  it('is reproducible from its seed and changes with it', () => {
    expect(plannedCounts(DEFAULT_STAFF)).toEqual(plannedCounts(DEFAULT_STAFF));
    expect(plannedCounts({ ...DEFAULT_STAFF, seed: 1 })).not.toEqual(plannedCounts(DEFAULT_STAFF));
    const a = rng(42);
    const b = rng(42);
    expect([a.next(), a.next(), a.int(1, 6)]).toEqual([b.next(), b.next(), b.int(1, 6)]);
  });

  it('has a name pool for every country', () => {
    for (const c of COUNTRIES) {
      const pool = NAME_POOLS[c.code];
      expect(pool).toBeDefined();
      expect(pool.male.length).toBeGreaterThanOrEqual(10);
      expect(pool.female.length).toBeGreaterThanOrEqual(10);
      expect(pool.last.length).toBeGreaterThanOrEqual(10);
    }
  });
});
