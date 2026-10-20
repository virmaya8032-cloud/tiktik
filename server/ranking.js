/**
 * For You ranking: engagement quality x freshness x personal affinity, with a
 * little randomness so the feed doesn't feel frozen. Deliberately simple and
 * transparent; every factor is computed from data in this app's database.
 */
export function rankForYou(db, candidates, viewerId, count) {
  if (candidates.length === 0) return [];
  const now = Date.now();

  const watchStats = new Map(
    db.prepare(`SELECT video_id, COUNT(*) AS n, AVG(completed) AS completion FROM watch_events GROUP BY video_id`)
      .all().map((r) => [r.video_id, r]),
  );

  let categoryAffinity = new Map();
  let seen = new Set();
  if (viewerId) {
    categoryAffinity = new Map(
      db.prepare(`SELECT v.category, COUNT(*) AS n FROM (
          SELECT video_id FROM likes WHERE user_id = :u
          UNION ALL SELECT video_id FROM favorites WHERE user_id = :u
          UNION ALL SELECT video_id FROM watch_events WHERE user_id = :u AND completed = 1
        ) x JOIN videos v ON v.id = x.video_id GROUP BY v.category`).all({ u: viewerId }).map((r) => [r.category, r.n]),
    );
    seen = new Set(db.prepare('SELECT DISTINCT video_id FROM watch_events WHERE user_id = ?').all(viewerId).map((r) => r.video_id));
  }
  const affinityTotal = [...categoryAffinity.values()].reduce((a, b) => a + b, 0);

  const scored = candidates.map((v) => {
    const s = v.stats;
    const w = watchStats.get(v.id);
    const engagement = 1 + s.likes * 2 + s.comments * 3 + s.shares * 4 + s.favorites * 3 + s.views * 0.05;
    const quality = Math.log2(1 + engagement) * (0.6 + (w ? w.completion : 0.5));
    const ageHours = (now - v.createdAt) / 3_600_000;
    const freshness = 1 / (1 + ageHours / 72);
    const affinity = affinityTotal ? 1 + (2 * (categoryAffinity.get(v.category) || 0)) / affinityTotal : 1;
    const social = v.viewer.followingAuthor ? 1.3 : 1;
    const novelty = seen.has(v.id) ? 0.35 : 1;
    const jitter = 0.85 + Math.random() * 0.3;
    return { v, score: quality * (0.5 + freshness) * affinity * social * novelty * jitter };
  });

  scored.sort((a, b) => b.score - a.score);

  // Diversity pass: avoid the same creator twice in a row.
  const out = [];
  const pool = scored.map((x) => x.v);
  while (out.length < count && pool.length) {
    const last = out[out.length - 1];
    let i = pool.findIndex((v) => !last || v.author.id !== last.author.id);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
