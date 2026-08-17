import { GarminApiError } from "./garmin/types.js";
import { sanitizeErrorMessage } from "./utils/helpers.js";

export function formatToolError(error: unknown): string {
  if (error instanceof GarminApiError) {
    if (error.statusCode === 429) {
      return `${error.message} Retry in ${error.retryAfterSeconds ?? 60} seconds.`;
    }
    return sanitizeErrorMessage(error.message);
  }

  if (error instanceof Error) {
    if (error.message.toLowerCase().includes("authentication")) {
      return `${sanitizeErrorMessage(error.message)} Run "trainbud auth" to re-authenticate.`;
    }

    return sanitizeErrorMessage(error.message);
  }

  return "An unexpected error occurred while executing the Garmin tool.";
}
