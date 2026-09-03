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
// Reordered in 1.3.0. Cards 0-6 were the four numbers Garmin already shows on
// the same wrist, so opening the app landed on data the user had just scrolled
// past. TODAY comes first because it is the one screen Connect cannot draw —
// what stands out, measured against this user's own baseline — and ASK second
// because its questions are now generated from those findings. The metric cards
// are all still here, one swipe further on, for when the number is what you
// actually wanted.
//
// Added in 1.4.0: WEEK. Training is planned in weeks and every other screen
// here answers "how am I today"; the store has been able to answer "how was the
// week" since the memory layer landed and nothing ever asked it. Placed after
// the AI cards and before the metric cards, so the three screens Connect cannot
// draw come first and the raw numbers stay one swipe further on.
module Cards {
    const TODAY      = 0;   // findings against the user's own baselines
    const ASK_AI     = 1;   // prompts generated from those findings
    const AI_INSIGHT = 2;   // daily one-line AI tip
    const WEEK       = 3;   // this week vs last, load forecast, sleep debt
    const OVERVIEW   = 4;   // 2x2 grid: recovery, sleep, stress, VO2 max
    const RECOVERY   = 5;   // recovery score + ring, with resting/max HR
    const SLEEP      = 6;   // hours + quality score
    const ACTIVITY   = 7;   // latest workout, with VO2 max and trend
    const STRESS     = 8;   // daily average

    const COUNT      = 9;
}
