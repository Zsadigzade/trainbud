import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSleepPayload, renderSleepText } from "../src/tools/sleep.js";
import { buildHeartRatePayload, renderHeartRateText } from "../src/tools/heartRate.js";
import { buildStressPayload, renderStressText } from "../src/tools/stress.js";
import { buildVo2MaxPayload, renderVo2MaxText } from "../src/tools/vo2Max.js";
import { renderRecoveryText } from "../src/tools/recovery.js";
import {
  buildBodyCompositionPayload,
  renderBodyCompositionText,
} from "../src/tools/bodyComposition.js";

// The `text` field of every tool is a public interface: it is what Claude
// Desktop and Cursor read, and it was until recently also what the watch parsed
// numbers back out of. These renderers were moved by hand out of six handlers,
// so this file pins the exact output. If a line changes here, either the move
// dropped something or the wording was changed on purpose -- and the second
// case deserves a sentence in the commit message.

describe("MCP text contract", () => {
  it("renders the sleep block exactly", () => {
    const text = renderSleepText(
      buildSleepPayload(
        [
          {
            date: "2026-08-19",
            totalSleepSeconds: 22680,
            deepSleepSeconds: 4800,
            lightSleepSeconds: 13080,
            remSleepSeconds: 4800,
            awakeCount: 2,
            sleepScore: 78,
            avgSleepStress: 21,
            avgOvernightHrv: 44,
            hrvStatus: "BALANCED",
          },
        ],
        7
      )
    );

    assert.equal(
      text,
      [
        "Sleep summary for last 1 recorded nights:",
        "Average sleep score: 78",
        "2026-08-19:",
        "  Total sleep: 6h 18m 0s",
        "  Deep: 1h 20m 0s | Light: 3h 38m 0s | REM: 1h 20m 0s",
        "  Score: 78 | Awakenings: 2",
        "  Avg sleep stress: 21",
      ].join("\n")
    );
  });

  it("renders the heart rate block exactly", () => {
    const text = renderHeartRateText(
      buildHeartRatePayload(
        [
          {
            date: "2026-08-19",
            restingHeartRate: 52,
            maxHeartRate: 171,
            minHeartRate: 46,
            averageHeartRate: 68,
          },
        ],
        30
      )
    );

    assert.equal(
      text,
      [
        "Heart rate trends over 1 days:",
        "Current resting HR: 52 bpm",
        "Average resting HR: 52 bpm",
        // calculateTrend needs two points; one reading is not a direction.
        "Trend: insufficient_data",
        "",
        "Recent days:",
        "2026-08-19: resting 52 bpm, max 171 bpm",
      ].join("\n")
    );
  });

  it("renders the stress block exactly", () => {
    const text = renderStressText(
      buildStressPayload(
        [
          {
            date: "2026-08-19",
            averageStress: 34,
            maxStress: 88,
            restStress: null,
            stressDurationSeconds: null,
          },
        ],
        7
      )
    );

    assert.equal(
      text,
      [
        "Stress levels over 1 recorded days:",
        "Average stress: 34",
        "Recent days:",
        "2026-08-19: avg 34, max 88",
      ].join("\n")
    );
  });

  it("renders the VO2 max block exactly", () => {
    const text = renderVo2MaxText(
      buildVo2MaxPayload([{ date: "2026-08-19", vo2Max: 46, vo2MaxCycling: null }], 30)
    );

    assert.equal(
      text,
      [
        "VO2 max trends over 1 recorded days:",
        "Current VO2 max: 46",
        "Recent entries:",
        "2026-08-19: VO2 max 46",
      ].join("\n")
    );
  });

  it("renders the recovery block exactly", () => {
    const text = renderRecoveryText({
      date: "2026-08-19",
      storedThrough: null,
      recovery: {
        score: 91,
        status: "recovered",
        recommendation:
          "You look recovered. Hard training or a quality session is appropriate today.",
        components: { hrvScore: 95, sleepScore: 88, stressScore: 95, restingHrScore: 90 },
      },
    });

    assert.equal(
      text,
      [
        "Recovery score: 91/100 (recovered)",
        "You look recovered. Hard training or a quality session is appropriate today.",
        "",
        "Component scores:",
        "- HRV: 95",
        "- Sleep: 88",
        "- Stress: 95",
        "- Resting HR: 90",
        "",
        "Date: 2026-08-19",
      ].join("\n")
    );
  });

  it("renders the body composition block exactly", () => {
    const text = renderBodyCompositionText(
      buildBodyCompositionPayload(
        [
          { date: "2026-08-19", weightKg: 74.2, bodyFatPercent: 15.1, muscleMassKg: 60.4, bmi: 22.1 },
          { date: "2026-07-19", weightKg: 76.0, bodyFatPercent: 16.3, muscleMassKg: 60.1, bmi: 22.6 },
        ],
        30
      )
    );

    assert.equal(
      text,
      [
        "Body composition over 2 recorded days:",
        "Current weight: 74.2 kg",
        "Current body fat: 15.1%",
        "Current muscle mass: 60.4 kg",
        "Weight change from baseline: -1.8 kg",
        "Body fat change from baseline: -1.2%",
        "Weight trend: improving",
        "Body fat trend: improving",
        // 60.1 -> 60.4 kg is inside calculateTrend's stability band.
        "Muscle trend: stable",
        "",
        "Recent entries:",
        "2026-08-19: 74.2 kg | body fat 15.1% | muscle 60.4 kg",
        "2026-07-19: 76.0 kg | body fat 16.3% | muscle 60.1 kg",
      ].join("\n")
    );
  });
});
