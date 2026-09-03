import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;

//
// Every screen this app can draw, on demand, with no server.
//
// Reaching a screen like "the AI call failed because the provider refused"
// normally requires a live HTTPS endpoint, a valid pair, an API key, and a
// failure arriving on cue. The practical consequence was that the failure
// screens were written, compiled, type-checked, reviewed, shipped -- and never
// once looked at. 1.3.0 reached the Connect IQ store having never been drawn,
// and the first simulator run of 1.3.1 found six layout bugs in an afternoon.
//
// This module removes the excuse. `build.ps1 -Screens` produces a build that
// starts in state 0 and steps through every screen on START/DOWN, so a full
// visual pass is a build and a keypress, on any device in the manifest.
//
// DEBUG ONLY. Never in the store package; build.ps1 -Package refuses it.
//
(:screensReal)
module ScreenTour {

    // Keep in step with `apply` and `label`.
    const SETUP            = 0;
    const PAIRING          = 1;
    const PAIR_UNREACHABLE = 2;
    const PAIR_NOT_SERVER  = 3;
    const PAIR_REFUSED     = 4;
    const FETCH_NOT_SERVER = 5;
    const FETCH_UNAUTH     = 6;
    const FETCH_NO_PHONE   = 7;
    const TODAY            = 8;
    const TODAY_COLD       = 23;  // appended: renumbering shifts every capture filename
    const WEEK             = 24;
    const WEEK_COLD        = 25;
    const WEEK_RACE        = 26;
    const ASK_BUDGET       = 27;  // the user's own monthly AI cap, reached
    const ASK_MENU         = 9;
    const ASK_NO_KEY       = 10;
    const ASK_THINKING     = 11;
    const ASK_ANSWER       = 12;
    const ASK_JOB_ERROR    = 13;
    const ASK_TRANSPORT    = 14;
    const ASK_TIMEOUT      = 15;
    const INSIGHT          = 16;
    const INSIGHT_NO_KEY   = 17;
    const OVERVIEW         = 18;
    const RECOVERY         = 19;
    const SLEEP            = 20;
    const ACTIVITY         = 21;
    const STRESS           = 22;
    const STATE_COUNT      = 28;

    // Where the tour currently is. A module variable rather than a field on the
    // app, so the app carries none of this in a build a user can install.
    var _index as Number = 0;

    function isActive() as Boolean { return true; }

    function count() as Number { return STATE_COUNT; }

    function index() as Number { return _index; }

    function enter(app as TrainBudApp) as Void {
        apply(app, _index);
    }

    function step(app as TrainBudApp, forward as Boolean) as Void {
        _index = forward
            ? (_index + 1) % STATE_COUNT
            : (_index + STATE_COUNT - 1) % STATE_COUNT;
        apply(app, _index);
    }

    function label(i as Number) as String {
        var names = [
            "setup", "pairing", "pair-unreachable", "pair-not-server",
            "pair-refused", "fetch-not-server", "fetch-unauthorised",
            "fetch-no-phone", "today", "ask-menu", "ask-no-key",
            "ask-thinking", "ask-answer", "ask-job-error", "ask-transport",
            "ask-timeout", "insight", "insight-no-key", "overview",
            "recovery", "sleep", "activity", "stress", "today-cold-start",
            "week", "week-cold-start", "week-race-week", "ask-budget"
        ];
        if (i < 0 || i >= names.size()) { return "?"; }
        return names[i] as String;
    }

    //
    // A long answer on purpose.
    //
    // The old renderer cut the answer into eighty-character substrings and drew
    // each with one drawText, which does not wrap -- so a real answer ran off
    // both edges on one line and the cut fell mid-word. A short string would
    // have hidden that. This one is three sentences, which is what the server's
    // system prompt asks the model for, and it must page cleanly.
    //
    const LONG_ANSWER =
        "Your resting heart rate is four beats above your own thirty-day median "
        + "and sleep has been short for three nights, so today is a good day to "
        + "keep the effort easy. An hour of zone two, or a rest day, will do more "
        + "for the week than another hard session. Check in again tomorrow.";

    function apply(app as TrainBudApp, index as Number) as Void {
        // Every state starts from a clean slate, so a screen never inherits a
        // field the previous one happened to set.
        app.setSummary(null);
        app.setPromptState("idle", null, null, Fail.NONE, null);
        app.setSummaryFailure(Fail.NONE, null);
        app.setPairFailure(Fail.UNREACHABLE, null);
        app.setCardById(Cards.TODAY);
        app.setAskMenuIndex(0);

        if (index == SETUP) {
            app.setStatus("config");
            return;
        }

        if (index == PAIRING) {
            app.setPairCode("042317");
            app.setPairExpiresAt(Time.now().value() + 240);
            app.setStatus("pairing");
            return;
        }

        if (index == PAIR_UNREACHABLE) {
            app.setPairFailure(Fail.UNREACHABLE, Communications.BLE_CONNECTION_UNAVAILABLE);
            app.setStatus("pairing_error");
            return;
        }

        // The Forerunner 55 report, exactly: a tunnel that is no longer running
        // answers an HTML error page, Connect IQ cannot parse it as JSON, -400.
        if (index == PAIR_NOT_SERVER) {
            app.setPairFailure(Fail.NOT_SERVER,
                Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE);
            app.setStatus("pairing_error");
            return;
        }

        if (index == PAIR_REFUSED) {
            app.setPairFailure(Fail.REFUSED, 429);
            app.setStatus("pairing_error");
            return;
        }

        if (index == FETCH_NOT_SERVER) {
            app.setSummaryFailure(Fail.NOT_SERVER,
                Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE);
            app.setStatus("error");
            return;
        }

        // A rotated API key. This drew "Could not reach TrainBud" until 1.3.2,
        // which is false and sends the user to look at their phone.
        if (index == FETCH_UNAUTH) {
            app.setSummaryFailure(Fail.UNAUTHORIZED, 401);
            app.setStatus("error");
            return;
        }

        if (index == FETCH_NO_PHONE) {
            app.setSummaryFailure(Fail.UNREACHABLE,
                Communications.BLE_CONNECTION_UNAVAILABLE);
            app.setStatus("error");
            return;
        }

        // Everything below draws a card, so it needs a summary.
        //
        // ONE summary, built once and adjusted in place.
        //
        // The variant states used to call sampleSummary() a second time while
        // the first was still held by the app, so two full payloads were live
        // at once -- and on the Forerunner 55 that is the difference between
        // fitting and not. The tour stopped dead at the first of those states:
        // the app ran out of memory, the simulator stopped accepting keys, and
        // the capture script photographed the previous screen three more times
        // and reported "keypress did not register". It looked like the
        // simulator being unreliable, which it is often enough to be a
        // convincing explanation for a real bug.
        var summary = sampleSummary(index != ASK_NO_KEY && index != INSIGHT_NO_KEY);

        // A week that cannot be compared yet, which is what the first fortnight
        // after install looks like.
        if (index == WEEK_COLD) {
            (summary.get("week") as Dictionary).put("ready", false);
        }

        // Race week, with a spike forecast on top of it -- the combination the
        // card exists to make legible.
        if (index == WEEK_RACE) {
            summary.put("race", { "text" => "Club 5k", "days_away" => 4, "phase" => "race_week" });
        }

        // The first two weeks after install, when there is not yet enough
        // history to compare a day against anything. It is the state every new
        // user sees first and it had never been drawn.
        if (index == TODAY_COLD) {
            summary.put("coverage", { "days" => 6, "ready" => false });
        }

        app.setSummary(summary);
        app.setStatus("ready");

        if (index == TODAY)      { app.setCardById(Cards.TODAY); return; }
        if (index == TODAY_COLD) { app.setCardById(Cards.TODAY); return; }
        if (index == WEEK || index == WEEK_COLD || index == WEEK_RACE) {
            app.setCardById(Cards.WEEK);
            return;
        }
        if (index == OVERVIEW) { app.setCardById(Cards.OVERVIEW); return; }
        if (index == RECOVERY) { app.setCardById(Cards.RECOVERY); return; }
        if (index == SLEEP)    { app.setCardById(Cards.SLEEP);    return; }
        if (index == ACTIVITY) { app.setCardById(Cards.ACTIVITY); return; }
        if (index == STRESS)   { app.setCardById(Cards.STRESS);   return; }

        if (index == INSIGHT || index == INSIGHT_NO_KEY) {
            app.setCardById(Cards.AI_INSIGHT);
            return;
        }

        app.setCardById(Cards.ASK_AI);

        // The user's own monthly cap, reached. Drawn here because every AI
        // screen this app has ever shipped undrawn has shipped broken, twice.
        if (index == ASK_BUDGET) {
            summary.put("budget", { "exceeded" => true, "incomplete" => false });
            app.setSummary(summary);
            return;
        }

        if (index == ASK_MENU || index == ASK_NO_KEY) { return; }

        if (index == ASK_THINKING) {
            app.setPromptState("waiting", null, null, Fail.NONE, null);
            return;
        }

        if (index == ASK_ANSWER) {
            app.setPromptState("done", LONG_ANSWER, null, Fail.NONE, null);
            return;
        }

        // The AI was reached and failed. This is the only state where the words
        // "AI unavailable" are true, and the server's own reason is on screen.
        if (index == ASK_JOB_ERROR) {
            app.setPromptState("error", null,
                "ANTHROPIC_API_KEY not configured. Set it in the dashboard or .env file.",
                Fail.NONE, null);
            return;
        }

        // The reported bug. Before 1.3.2 this drew "AI unavailable / HTTP -400"
        // over a request that never reached the server and never asked the AI
        // anything at all.
        if (index == ASK_TRANSPORT) {
            app.setPromptState("error", null, null, Fail.NOT_SERVER,
                Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE);
            return;
        }

        if (index == ASK_TIMEOUT) {
            app.setPromptState("error", null, "Answer took too long", Fail.NONE, null);
            return;
        }
    }

    /** A payload shaped exactly like /api/watch, with the longest plausible
        values rather than the tidiest: a clipped screen is only visible when
        something is long enough to clip. */
    function sampleSummary(aiConfigured as Boolean) as Dictionary {
        return {
            "updated_at"    => "2026-09-03T08:41:00Z",
            "ai_configured" => aiConfigured,
            "ai_insight"    => aiConfigured
                ? "Resting heart rate is up and sleep is short, so keep today easy and reassess tomorrow."
                : null,
            "daily_overview" => {
                "recovery" => 62,
                "sleep_h"  => 6.3,
                "stress"   => 41,
                "vo2max"   => 48
            },
            "recovery" => { "score" => 62, "label" => "Ready", "resting_hr" => 48, "max_hr" => 178 },
            "sleep"    => { "hours" => 6.3, "score" => 71, "label" => "Fair" },
            "stress"   => { "avg" => 41, "label" => "Moderate" },
            "vo2max"   => { "value" => 48, "trend" => "steady" },
            "heart_rate" => { "resting" => 48, "max" => 178 },
            "activity" => {
                "name" => "Evening Threshold Intervals",
                "duration_min" => 62,
                "distance_km" => 12.4
            },
            "coverage" => { "days" => 86, "ready" => true },
            "findings" => [
                { "kind" => "resting_hr", "severity" => "warn",
                  "headline" => "Resting HR 4 bpm above your 30-day median for 3 days" },
                { "kind" => "sleep_debt", "severity" => "notice",
                  "headline" => "Sleep 1.2h below your average across the last week" }
            ],
            "race" => null,
            "week" => {
                "sessions"          => 4,
                "previous_sessions" => 3,
                "moving_minutes"    => 212,
                "load_delta_pct"    => 34,
                "sleep_debt_h"      => 3.4,
                "sleep_habitual_h"  => 7.2,
                "sleep_consistency" => "variable",
                "forecast_ratio"    => 1.62,
                "forecast_verdict"  => "spike_ahead",
                "ready"             => true,
                "headline"          => "4 sessions this week. Load up 34, Sleep down 1.1h versus last week."
            },
            "prompts" => [
                "Why is my resting HR up?",
                "Should I train today?",
                "How is my recovery?",
                "Am I overtraining?",
                "Summarize my week"
            ],

            // The four fields the server now grades for the watch. Without
            // them the tour would draw every card ungraded and photograph
            // twenty-seven screens that prove nothing about the colours -- the
            // exact failure the tour exists to prevent, one layer up.
            //
            // Chosen so the set exercises all four states: recovery caution,
            // sleep hard, stress caution, and resting heart rate deliberately
            // "unknown" so at least one screen shows an ungraded value.
            "states" => {
                "recovery"   => "caution",
                "sleep"      => "hard",
                "stress"     => "caution",
                "resting_hr" => "unknown"
            },
            // No "display" block on purpose. The carousel it would carry is
            // identical to Cards.defaultOrder(), so the app falls back to the
            // same nine cards -- and on the Forerunner 55 those nine strings
            // plus their array and dictionary are the difference between the
            // tour fitting in memory and the simulator dying halfway through
            // the run. The reorder path is covered by the server's own tests.
            "alert"  => { "level" => "warn", "count" => 2 },
            "budget" => { "exceeded" => false, "incomplete" => false }
        };
    }
}
