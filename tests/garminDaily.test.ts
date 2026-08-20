import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fetchBodyCompositionDay,
  fetchHeartRateDay,
  fetchSleepDay,
  fetchStressDay,
  fetchVo2MaxDay,
  mapHeartRateData,
  mapSleepData,
  mapWeightData,
} from "../src/garmin/daily.js";
import type { GarminConnectInstance } from "../src/garmin/garminConnect.js";

const DATE = new Date("2026-08-19T00:00:00.000Z");

/** Only the method under test needs a real implementation. */
function fakeClient(overrides: Partial<GarminConnectInstance>): GarminConnectInstance {
  return overrides as unknown as GarminConnectInstance;
}

const SLEEP_PAYLOAD = {
  avgOvernightHrv: 44,
  hrvStatus: "BALANCED",
  dailySleepDTO: {
    sleepTimeSeconds: 22680,
    deepSleepSeconds: 4800,
    lightSleepSeconds: 13080,
    remSleepSeconds: 4800,
    awakeCount: 2,
    avgSleepStress: 21,
    sleepScores: { overall: { value: 78 } },
  },
};

describe("daily sleep fetch", () => {
  it("returns the response untouched alongside the mapped night", async () => {
    const client = fakeClient({ getSleepData: async () => SLEEP_PAYLOAD });
    const { raw, mapped } = await fetchSleepDay(client, DATE);

    assert.equal(raw, SLEEP_PAYLOAD);
    assert.equal(mapped?.date, "2026-08-19");
    assert.equal(mapped?.totalSleepSeconds, 22680);
    assert.equal(mapped?.sleepScore, 78);
    assert.equal(mapped?.avgOvernightHrv, 44);
  });

  // Garmin omits dailySleepDTO on nights it has nothing for. The raw response
  // is still archived: "we asked and there was nothing" is worth keeping.
  it("maps to null but still returns raw when the night is absent", async () => {
    const payload = { avgOvernightHrv: null };
    const client = fakeClient({ getSleepData: async () => payload });
    const { raw, mapped } = await fetchSleepDay(client, DATE);

    assert.equal(raw, payload);
    assert.equal(mapped, null);
  });

  it("survives a night Garmin scored but did not stage", () => {
    const mapped = mapSleepData(DATE, {
      dailySleepDTO: {
        sleepTimeSeconds: 21600,
        deepSleepSeconds: 0,
        lightSleepSeconds: 0,
        remSleepSeconds: 0,
        awakeCount: 0,
      },
    });

    assert.equal(mapped?.sleepScore, null);
    assert.equal(mapped?.avgOvernightHrv, null);
    assert.equal(mapped?.totalSleepSeconds, 21600);
  });
});

describe("daily heart rate fetch", () => {
  it("averages the sample array and keeps the resting reading", async () => {
    const payload = {
      restingHeartRate: 52,
      maxHeartRate: 171,
      minHeartRate: 46,
      heartRateValues: [[{ heartrate: 60 }, { heartrate: 80 }]],
    };
    const client = fakeClient({ getHeartRate: async () => payload });
    const { raw, mapped } = await fetchHeartRateDay(client, DATE);

    assert.equal(raw, payload);
    assert.equal(mapped?.restingHeartRate, 52);
    assert.equal(mapped?.maxHeartRate, 171);
    assert.equal(mapped?.averageHeartRate, 70);
  });

  // Null entries inside heartRateValues crashed this tool on a real account
  // before they were guarded; keep the guard covered.
  it("skips null sample entries", () => {
    const mapped = mapHeartRateData(DATE, {
      restingHeartRate: 50,
      heartRateValues: [[{ heartrate: 60 }, null], null],
    });

    assert.equal(mapped?.averageHeartRate, 60);
  });

  it("returns null when a day carries neither a resting nor a sampled rate", () => {
    assert.equal(mapHeartRateData(DATE, { heartRateValues: [] }), null);
  });
});

describe("daily stress fetch", () => {
  it("maps the field Connect actually sends", async () => {
    const payload = { calendarDate: "2026-08-19", avgStressLevel: 34, maxStressLevel: 88 };
    const client = fakeClient({ get: async () => payload });
    const { raw, mapped } = await fetchStressDay(client, DATE);

    assert.equal(raw, payload);
    assert.equal(mapped?.averageStress, 34);
    assert.equal(mapped?.maxStress, 88);
  });

  it("treats a negative level as a sentinel, not a reading", async () => {
    const client = fakeClient({ get: async () => ({ avgStressLevel: -1, maxStressLevel: -1 }) });
    const { mapped } = await fetchStressDay(client, DATE);

    assert.equal(mapped?.averageStress, null);
    assert.equal(mapped?.maxStress, null);
  });

  it("asks for the date as a path segment", async () => {
    let requested = "";
    const client = fakeClient({
      get: async (url: string) => {
        requested = url;
        return {};
      },
    });

    await fetchStressDay(client, DATE);
    assert.match(requested, /\/wellness-service\/wellness\/dailyStress\/2026-08-19$/);
  });
});

describe("daily VO2 max fetch", () => {
  it("reads the generic and cycling values", async () => {
    const payload = { generic: { vo2MaxValue: 46 }, cycling: { vo2MaxValue: 41 } };
    const client = fakeClient({ get: async () => payload });
    const { raw, mapped } = await fetchVo2MaxDay(client, DATE);

    assert.equal(raw, payload);
    assert.equal(mapped?.vo2Max, 46);
    assert.equal(mapped?.vo2MaxCycling, 41);
  });

  it("asks for maxmet/latest, not maxmet/daily", async () => {
    let requested = "";
    const client = fakeClient({
      get: async (url: string) => {
        requested = url;
        return {};
      },
    });

    await fetchVo2MaxDay(client, DATE);
    assert.match(requested, /\/metrics-service\/metrics\/maxmet\/latest\/2026-08-19$/);
  });
});

describe("daily body composition fetch", () => {
  it("maps every weigh-in the day carries", async () => {
    const payload = {
      dateWeightList: [
        { calendarDate: "2026-08-19", weight: 74.2, bodyFat: 15.1, muscleMass: 60.4, bmi: 22.1 },
      ],
    };
    const client = fakeClient({ getDailyWeightData: async () => payload });
    const { raw, mapped } = await fetchBodyCompositionDay(client, DATE);

    assert.equal(raw, payload);
    assert.equal(mapped?.length, 1);
    assert.equal(mapped?.[0]?.weightKg, 74.2);
    assert.equal(mapped?.[0]?.date, "2026-08-19");
  });

  it("falls back to the requested date when Connect omits the calendar date", () => {
    const mapped = mapWeightData(DATE, {
      dateWeightList: [{ calendarDate: "", weight: 74.2, bodyFat: null, muscleMass: null, bmi: null }],
    });

    assert.equal(mapped[0]?.date, "2026-08-19");
  });

  it("returns null for a day with no weigh-in at all", async () => {
    const client = fakeClient({ getDailyWeightData: async () => ({ dateWeightList: [] }) });
    const { mapped } = await fetchBodyCompositionDay(client, DATE);

    assert.equal(mapped, null);
  });
});
