//
// Card indices for the main carousel.
//
// These used to be bare numbers repeated across the app, view and delegate —
// "card 8" appeared in four files, so merging cards meant finding every one of
// them. Naming them keeps the carousel definition in a single place.
//
// Merged in 1.2.0: resting/max heart rate now shares the Recovery card, and
// VO2 max shares the Activity card, taking the carousel from 9 cards to 7.
//
module Cards {
    const OVERVIEW   = 0;   // 2x2 grid: recovery, sleep, stress, VO2 max
    const RECOVERY   = 1;   // recovery score + ring, with resting/max HR
    const SLEEP      = 2;   // hours + quality score
    const ACTIVITY   = 3;   // latest workout, with VO2 max and trend
    const STRESS     = 4;   // daily average
    const AI_INSIGHT = 5;   // daily one-line AI tip
    const ASK_AI     = 6;   // preset prompt menu + paged result

    const COUNT      = 7;
}
