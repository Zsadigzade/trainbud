import type {
  HeartRateData,
  SleepData,
  WeightDataResponse,
} from "./garminApiTypes.js";
import type { GarminConnectInstance } from "./garminConnect.js";
import {
  fetchDailyStress,
  fetchMaxMetrics,
  mapDailyStress,
  mapMaxMetrics,
  type DailyStressSummary,
  type Vo2MaxEntry,
} from "./rawApi.js";
import type {
  BodyCompositionEntry,
  HeartRateDaySummary,
  SleepNightSummary,
} from "./types.js";
import { average, formatIsoDate } from "../utils/helpers.js";

// SECTION: Per-date fetchers
//
// One place where a Garmin response for a single day is turned into a row. The
// tools call these inside their batched loops; ingest calls them one at a time
// with a delay. Both get the same mapping, which is the point: two copies of
// "which field is the average stress" is exactly how a mapper reading
// `overallStressLevel` -- a field Connect does not send -- shipped with a
// passing test written against the same invented shape.
//
// Each returns the untouched response alongside the mapped row, so ingest can
// archive one and store the other without fetching twice.

export interface DailyFetch<T> {
  raw: unknown;
  mapped: T | null;
}

// SECTION: Mappers

export function mapSleepData(date: Date, sleepData: SleepData): SleepNightSummary | null {
  const dailySleep = sleepData.dailySleepDTO;

  if (!dailySleep) {
    return null;
  }

  return {
    date: formatIsoDate(date),
    totalSleepSeconds: dailySleep.sleepTimeSeconds,
    deepSleepSeconds: dailySleep.deepSleepSeconds,
    lightSleepSeconds: dailySleep.lightSleepSeconds,
    remSleepSeconds: dailySleep.remSleepSeconds,
    awakeCount: dailySleep.awakeCount,
    sleepScore: dailySleep.sleepScores?.overall?.value ?? null,
    avgSleepStress: dailySleep.avgSleepStress ?? null,
    avgOvernightHrv: sleepData.avgOvernightHrv ?? null,
    hrvStatus: sleepData.hrvStatus ?? null,
  };
}

export function mapHeartRateData(
  date: Date,
  heartRate: HeartRateData | null
): HeartRateDaySummary | null {
  if (!heartRate) {
    return null;
  }

  // Connect returns null entries inside heartRateValues, and null rows in place
  // of whole buckets. Both crashed this on a real account before the guard.
  const samples = (heartRate.heartRateValues ?? [])
    .flat()
    .filter((entry): entry is { heartrate: number } => entry != null)
    .map((entry) => entry.heartrate);

  const averageHeartRate = samples.length > 0 ? average(samples) : null;

  if (heartRate.restingHeartRate == null && averageHeartRate == null) {
    return null;
  }

  return {
    date: formatIsoDate(date),
    restingHeartRate: heartRate.restingHeartRate ?? null,
    maxHeartRate: heartRate.maxHeartRate ?? null,
    minHeartRate: heartRate.minHeartRate ?? null,
    averageHeartRate,
  };
}

export function mapWeightData(
  date: Date,
  weightData: WeightDataResponse
): BodyCompositionEntry[] {
  return weightData.dateWeightList.map((entry) => ({
    date: entry.calendarDate || formatIsoDate(date),
    weightKg: entry.weight ?? null,
    bodyFatPercent: entry.bodyFat ?? null,
    muscleMassKg: entry.muscleMass ?? null,
    bmi: entry.bmi ?? null,
  }));
}

// SECTION: Fetchers

export async function fetchSleepDay(
  client: GarminConnectInstance,
  date: Date
): Promise<DailyFetch<SleepNightSummary>> {
  const raw = await client.getSleepData(date);
  return { raw, mapped: mapSleepData(date, raw) };
}

export async function fetchHeartRateDay(
  client: GarminConnectInstance,
  date: Date
): Promise<DailyFetch<HeartRateDaySummary>> {
  const raw = await client.getHeartRate(date);
  return { raw, mapped: mapHeartRateData(date, raw) };
}

export async function fetchStressDay(
  client: GarminConnectInstance,
  date: Date
): Promise<DailyFetch<DailyStressSummary>> {
  const raw = await fetchDailyStress(client, date);
  return { raw, mapped: mapDailyStress(date, raw) };
}

export async function fetchVo2MaxDay(
  client: GarminConnectInstance,
  date: Date
): Promise<DailyFetch<Vo2MaxEntry>> {
  const raw = await fetchMaxMetrics(client, date);
  return { raw, mapped: mapMaxMetrics(date, raw) };
}

export async function fetchBodyCompositionDay(
  client: GarminConnectInstance,
  date: Date
): Promise<DailyFetch<BodyCompositionEntry[]>> {
  const raw = await client.getDailyWeightData(date);
  const mapped = mapWeightData(date, raw);
  return { raw, mapped: mapped.length > 0 ? mapped : null };
}
