/**
 * Confidence scoring and match tier classification utilities.
 * Converts ChromaDB distance values to human-interpretable confidence scores.
 */

import type { MatchTier, ConfidenceStats, TierDistribution, Community } from "./types.js";

/**
 * Convert ChromaDB distance to confidence score (0.0-1.0).
 * Lower distance = higher confidence.
 *
 * Breakpoints:
 * - <0.8:    confidence 0.90-1.0  (excellent match)
 * - 0.8-1.0: confidence 0.70-0.9  (strong match)
 * - 1.0-1.2: confidence 0.50-0.7  (moderate match)
 * - 1.2-1.4: confidence 0.30-0.5  (weak match)
 * - 1.4-2.0: confidence 0.10-0.3  (very weak match)
 */
export function calculateConfidenceFromDistance(distance: number): number {
  if (distance < 0.8) {
    return Math.min(1.0, 0.9 + (0.8 - distance) * 0.125);
  } else if (distance < 1.0) {
    return 0.7 + (1.0 - distance) * 1.0;
  } else if (distance < 1.2) {
    return 0.5 + (1.2 - distance) * 1.0;
  } else if (distance < 1.4) {
    return 0.3 + (1.4 - distance) * 1.0;
  } else {
    return Math.max(0.1, 0.3 - (distance - 1.4) * 0.33);
  }
}

/**
 * Classify match tier based on semantic distance.
 *
 * Breakpoints:
 * - <0.2:   exact      (highly relevant)
 * - <0.35:  semantic   (very relevant)
 * - <0.65:  adjacent   (somewhat relevant)
 * - >=0.65: peripheral (weakly relevant)
 */
export function classifyMatchTier(distance: number): MatchTier {
  if (distance < 0.2) return "exact";
  if (distance < 0.35) return "semantic";
  if (distance < 0.65) return "adjacent";
  return "peripheral";
}

/**
 * Calculate confidence statistics for a set of communities.
 */
export function calculateConfidenceStats(communities: Community[]): ConfidenceStats {
  if (communities.length === 0) {
    return { mean: 0, median: 0, min: 0, max: 0 };
  }

  const confidences = communities.map((c) => c.confidence).sort((a, b) => a - b);
  const sum = confidences.reduce((acc, val) => acc + val, 0);
  const mean = sum / confidences.length;

  const mid = Math.floor(confidences.length / 2);
  const median =
    confidences.length % 2 === 0
      ? (confidences[mid - 1] + confidences[mid]) / 2
      : confidences[mid];

  return {
    mean: Number(mean.toFixed(3)),
    median: Number(median.toFixed(3)),
    min: Number(confidences[0].toFixed(3)),
    max: Number(confidences[confidences.length - 1].toFixed(3)),
  };
}

/**
 * Calculate distribution of match tiers in results.
 */
export function calculateTierDistribution(communities: Community[]): TierDistribution {
  const distribution: TierDistribution = {
    exact: 0,
    semantic: 0,
    adjacent: 0,
    peripheral: 0,
  };

  for (const community of communities) {
    distribution[community.match_tier]++;
  }

  return distribution;
}
