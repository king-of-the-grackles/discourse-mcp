import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateConfidenceFromDistance,
  classifyMatchTier,
  calculateConfidenceStats,
  calculateTierDistribution,
} from "../chroma/scoring.js";
import type { Community } from "../chroma/types.js";

test("calculateConfidenceFromDistance", async (t) => {
  await t.test("returns high confidence for low distance (<0.8)", () => {
    const confidence = calculateConfidenceFromDistance(0.5);
    assert.ok(confidence >= 0.9, `Expected >= 0.9, got ${confidence}`);
    assert.ok(confidence <= 1.0, `Expected <= 1.0, got ${confidence}`);
  });

  await t.test("returns 1.0 for distance 0", () => {
    const confidence = calculateConfidenceFromDistance(0);
    assert.equal(confidence, 1.0);
  });

  await t.test("returns strong confidence for distance 0.8-1.0", () => {
    const confidence = calculateConfidenceFromDistance(0.9);
    assert.ok(confidence >= 0.7, `Expected >= 0.7, got ${confidence}`);
    assert.ok(confidence < 0.9, `Expected < 0.9, got ${confidence}`);
  });

  await t.test("returns moderate confidence for distance 1.0-1.2", () => {
    const confidence = calculateConfidenceFromDistance(1.1);
    assert.ok(confidence >= 0.5, `Expected >= 0.5, got ${confidence}`);
    assert.ok(confidence < 0.7, `Expected < 0.7, got ${confidence}`);
  });

  await t.test("returns weak confidence for distance 1.2-1.4", () => {
    const confidence = calculateConfidenceFromDistance(1.3);
    assert.ok(confidence >= 0.3, `Expected >= 0.3, got ${confidence}`);
    assert.ok(confidence < 0.5, `Expected < 0.5, got ${confidence}`);
  });

  await t.test("returns very weak confidence for distance >1.4", () => {
    const confidence = calculateConfidenceFromDistance(1.6);
    assert.ok(confidence >= 0.1, `Expected >= 0.1, got ${confidence}`);
    assert.ok(confidence < 0.3, `Expected < 0.3, got ${confidence}`);
  });

  await t.test("never returns below 0.1", () => {
    const confidence = calculateConfidenceFromDistance(3.0);
    assert.ok(confidence >= 0.1, `Expected >= 0.1, got ${confidence}`);
  });
});

test("classifyMatchTier", async (t) => {
  await t.test('returns "exact" for distance < 0.2', () => {
    assert.equal(classifyMatchTier(0.1), "exact");
    assert.equal(classifyMatchTier(0.19), "exact");
  });

  await t.test('returns "semantic" for distance 0.2-0.35', () => {
    assert.equal(classifyMatchTier(0.2), "semantic");
    assert.equal(classifyMatchTier(0.34), "semantic");
  });

  await t.test('returns "adjacent" for distance 0.35-0.65', () => {
    assert.equal(classifyMatchTier(0.35), "adjacent");
    assert.equal(classifyMatchTier(0.64), "adjacent");
  });

  await t.test('returns "peripheral" for distance >= 0.65', () => {
    assert.equal(classifyMatchTier(0.65), "peripheral");
    assert.equal(classifyMatchTier(1.0), "peripheral");
    assert.equal(classifyMatchTier(2.0), "peripheral");
  });
});

test("calculateConfidenceStats", async (t) => {
  await t.test("returns zeros for empty array", () => {
    const stats = calculateConfidenceStats([]);
    assert.deepEqual(stats, { mean: 0, median: 0, min: 0, max: 0 });
  });

  await t.test("calculates stats for single item", () => {
    const communities: Community[] = [
      makeCommunity({ confidence: 0.8 }),
    ];
    const stats = calculateConfidenceStats(communities);
    assert.equal(stats.mean, 0.8);
    assert.equal(stats.median, 0.8);
    assert.equal(stats.min, 0.8);
    assert.equal(stats.max, 0.8);
  });

  await t.test("calculates stats for multiple items", () => {
    const communities: Community[] = [
      makeCommunity({ confidence: 0.9 }),
      makeCommunity({ confidence: 0.7 }),
      makeCommunity({ confidence: 0.5 }),
    ];
    const stats = calculateConfidenceStats(communities);
    assert.equal(stats.mean, 0.7);
    assert.equal(stats.median, 0.7);
    assert.equal(stats.min, 0.5);
    assert.equal(stats.max, 0.9);
  });

  await t.test("calculates median for even number of items", () => {
    const communities: Community[] = [
      makeCommunity({ confidence: 0.9 }),
      makeCommunity({ confidence: 0.8 }),
      makeCommunity({ confidence: 0.6 }),
      makeCommunity({ confidence: 0.5 }),
    ];
    const stats = calculateConfidenceStats(communities);
    assert.equal(stats.median, 0.7); // Average of 0.6 and 0.8
  });
});

test("calculateTierDistribution", async (t) => {
  await t.test("returns zeros for empty array", () => {
    const dist = calculateTierDistribution([]);
    assert.deepEqual(dist, { exact: 0, semantic: 0, adjacent: 0, peripheral: 0 });
  });

  await t.test("counts tiers correctly", () => {
    const communities: Community[] = [
      makeCommunity({ match_tier: "exact" }),
      makeCommunity({ match_tier: "exact" }),
      makeCommunity({ match_tier: "semantic" }),
      makeCommunity({ match_tier: "adjacent" }),
      makeCommunity({ match_tier: "peripheral" }),
      makeCommunity({ match_tier: "peripheral" }),
    ];
    const dist = calculateTierDistribution(communities);
    assert.deepEqual(dist, { exact: 2, semantic: 1, adjacent: 1, peripheral: 2 });
  });
});

// Helper to create minimal Community objects for testing
function makeCommunity(overrides: Partial<Community>): Community {
  return {
    id: "test_1",
    title: "Test Community",
    url: "https://test.example.com",
    description: "A test community",
    users_count: 1000,
    active_users_30_days: 100,
    engagement_tier: "medium",
    categories: "General",
    tags: "test",
    confidence: 0.8,
    distance: 0.5,
    match_tier: "adjacent",
    ...overrides,
  };
}
