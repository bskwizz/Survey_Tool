'use strict';

/**
 * Streaming aggregation helpers shared by quant question types
 * (multiple choice, rating). All operations here are O(1) per new response -
 * we maintain running counts rather than rescanning the full response list,
 * so aggregate recomputation stays cheap no matter how many responses a
 * question has accumulated.
 */

/**
 * Normalized Shannon entropy in [0, 1], where 0 = perfect consensus
 * (all responses on one option) and 1 = maximum disagreement (uniform
 * spread across all options). Cheap to compute from running counts alone.
 *
 * @param {Record<string, number>} counts - option key -> running count
 * @returns {{ entropy: number, topOptionShare: number, consensus: 'high'|'medium'|'low' }}
 */
function computeConsensus(counts) {
  const values = Object.values(counts);
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) {
    return { entropy: 0, topOptionShare: 0, consensus: 'n/a' };
  }

  const k = values.length || 1;
  let entropySum = 0;
  let maxCount = 0;
  for (const c of values) {
    if (c > maxCount) maxCount = c;
    if (c === 0) continue;
    const p = c / total;
    entropySum += -p * Math.log2(p);
  }
  // Normalize by log2(k) so entropy is comparable across questions with
  // different numbers of options. Guard against k === 1 (log2(1) === 0).
  const maxEntropy = Math.log2(k) || 1;
  const normalizedEntropy = k > 1 ? entropySum / maxEntropy : 0;
  const topOptionShare = maxCount / total;

  let consensus;
  if (normalizedEntropy <= 0.35) consensus = 'high'; // strong agreement
  else if (normalizedEntropy <= 0.7) consensus = 'medium';
  else consensus = 'low'; // high disagreement / spread

  return {
    entropy: Number(normalizedEntropy.toFixed(4)),
    topOptionShare: Number(topOptionShare.toFixed(4)),
    consensus,
  };
}

/**
 * Build the percentages + histogram view from running counts. O(number of
 * options), never O(number of responses).
 */
function buildDistribution(counts, total) {
  const distribution = {};
  for (const [key, count] of Object.entries(counts)) {
    distribution[key] = {
      count,
      percentage: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
    };
  }
  return distribution;
}

/**
 * Incrementally fold one new option key into a counts map + total, returning
 * the fully recomputed derived stats (distribution + consensus). This is the
 * single O(1)-per-response hot path used by both MultipleChoiceType and
 * RatingType.
 */
function foldCount(aggregate, optionKey) {
  aggregate.counts[optionKey] = (aggregate.counts[optionKey] || 0) + 1;
  aggregate.responseCount += 1;
  aggregate.distribution = buildDistribution(aggregate.counts, aggregate.responseCount);
  Object.assign(aggregate, computeConsensus(aggregate.counts));
  return aggregate;
}

module.exports = { computeConsensus, buildDistribution, foldCount };
