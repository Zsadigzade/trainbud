import type { ActivitySummary, SleepNightSummary } from "../garmin/types.js";

// SECTION: Structured tool payloads
//
// One interface per tool, named after the tool. These are the shapes the
// history store, the detectors and the watch read. Nothing here is derived from
// formatted text: every field comes straight from a mapper over a Garmin
// response, so a change to how a tool prints itself cannot change what its
// consumers see.

export interface SleepPayload {
  requestedNights: number;
  recordedNights: number;
  averageScore: number | null;
  nights: SleepNightSummary[];
}

export interface LatestActivityPayload {
  activity: ActivitySummary | null;
}

export interface ActivitiesRangePayload {
  startDate: string;
  endDate: string;
  truncated: boolean;
  activities: ActivitySummary[];
}
