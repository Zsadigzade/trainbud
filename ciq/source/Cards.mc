import Toybox.Lang;

//
// The carousel, as ids rather than positions.
//
// It used to be a run of bare numbers -- "card 8" appeared in four files, so
// merging two cards meant finding every one of them. Naming them fixed that in
// 1.2.0, but they were still POSITIONS, and a position is the wrong identity
// for something the user can now reorder: with numeric constants, hiding the
// Stress card renumbers every card after it, and the delegate, the view and the
// stored state all disagree about what card 5 is.
//
// So a card is a string id, the order is an array of ids, and the position is
// only ever an index into that array. The order arrives from the server inside
// /api/watch as `display.cards`, which the user sets in the dashboard -- live
// on the next fetch, with no Connect IQ settings sync and no store update.
//
// DEFAULT_ORDER is the fallback, and it has to keep working: a watch pointed at
// an older server gets no `display` field at all, and must still draw a
// carousel. It is also the shipping order, chosen in 1.3.0 and extended in
// 1.4.0 -- the three screens Connect cannot draw come first, and the raw
// numbers Garmin already shows on the same wrist stay one swipe further on.
//
module Cards {
    const TODAY      = "today";    // findings against the user's own baselines
    const ASK_AI     = "ask";      // prompts generated from those findings
    const AI_INSIGHT = "insight";  // daily one-line AI tip
    const WEEK       = "week";     // this week vs last, load forecast, sleep debt
    const OVERVIEW   = "overview"; // 2x2 grid: recovery, sleep, stress, VO2 max
    const RECOVERY   = "recovery"; // recovery score + ring, with resting/max HR
    const SLEEP      = "sleep";    // hours + quality score
    const ACTIVITY   = "activity"; // latest workout, with VO2 max and trend
    const STRESS     = "stress";   // daily average

    function defaultOrder() as Array<String> {
        return [TODAY, ASK_AI, AI_INSIGHT, WEEK, OVERVIEW, RECOVERY, SLEEP, ACTIVITY, STRESS];
    }

    //
    // Keep only the ids this build knows how to draw.
    //
    // A server newer than the watch can name a card that does not exist here,
    // and the app would then reserve a slot in the carousel that renders as a
    // blank screen -- indistinguishable, on a wrist, from a crash. Unknown ids
    // are dropped; if that leaves nothing, the caller falls back to the default
    // order rather than showing a carousel of length zero.
    //
    function sanitize(ids) as Array<String> {
        var known = defaultOrder();
        var out = [] as Array<String>;

        if (ids == null || !(ids instanceof Array)) { return out; }

        var list = ids as Array;
        for (var i = 0; i < list.size(); i += 1) {
            var candidate = list[i];
            if (!(candidate instanceof String)) { continue; }

            var id = candidate as String;
            for (var k = 0; k < known.size(); k += 1) {
                if ((known[k] as String).equals(id)) {
                    out.add(id);
                    break;
                }
            }
        }
        return out;
    }
}
