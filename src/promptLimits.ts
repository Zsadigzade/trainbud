// SECTION: Ask menu limits
//
// The two numbers that describe the watch's Ask menu: how wide a question may
// be and how many the menu draws. They lived in promptSuggestions.ts, and the
// profile schema reads them at module load -- which made profile.ts import the
// suggestion builder, the suggestion builder import the detectors, and the
// detectors unable to import the profile for the user's own detector rules
// without a cycle that throws "Cannot access before initialization" depending
// on which module happened to load first. A leaf module has no such order.

/** Anything longer wraps or clips on a 390 px round screen. */
export const PROMPT_MAX_LENGTH = 32;

/** How many the watch draws. Also the cap on how many the user may write. */
export const PROMPT_SLOTS = 5;
