// Minimal Garmin Connect API shapes used by TrainBud (avoids importing garmin-connect/dist internals).

export interface GarminOAuth1 {
  oauth_token: string;
  oauth_token_secret: string;
}

export interface GarminOAuth2 {
  scope: string;
  jti: string;
  access_token: string;
  token_type: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number;
  refresh_token_expires_in: number;
  refresh_token_expires_at: number;
}

export interface StoredSessionTokens {
  oauth1: GarminOAuth1;
  oauth2: GarminOAuth2;
}

export interface IActivity {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  distance: number;
  duration: number;
  averageHR?: number;
  maxHR?: number;
  elevationGain: number;
  calories: number;
  averageSpeed: number;
  activityType: {
    typeKey: string;
  };
}

export interface SleepData {
  avgOvernightHrv?: number | null;
  hrvStatus?: string | null;
  dailySleepDTO?: {
    sleepTimeSeconds: number;
    deepSleepSeconds: number;
    lightSleepSeconds: number;
    remSleepSeconds: number;
    awakeCount: number;
    avgSleepStress?: number | null;
    sleepScores?: {
      overall?: {
        value: number;
      };
    };
  };
}

export interface HeartRateData {
  restingHeartRate?: number;
  maxHeartRate?: number;
  minHeartRate?: number;
  lastSevenDaysAvgRestingHeartRate?: number;
  heartRateValues?: Array<Array<{ heartrate: number } | null> | null> | null;
}

export interface WeightDataResponse {
  dateWeightList: Array<{
    calendarDate: string;
    weight: number;
    bodyFat: number | null;
    muscleMass: number | null;
    bmi: number | null;
  }>;
}
