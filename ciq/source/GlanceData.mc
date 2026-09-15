import Toybox.Application;
import Toybox.Lang;

//
// The few values the glance draws, stored on their own.
//
// The glance used to read the whole cached /api/watch payload out of Storage --
// findings, prompts, the week review, the carousel -- and it read it TWICE per
// draw, once for the finding and once for the numbers. Storage hands back a
// deserialised copy: a modest 1.6 KB payload is about 5 KB of Dictionary on the
// Forerunner 70, and a busy day several times that. The glance runs in 32 KB on
// the Forerunner 55, the 745 and the Instinct 3, and an out-of-memory there is
// not an error message: it is the launcher icon beside an empty strip.
//
// So the widget, which has room to spare, boils the payload down to this record
// every time it persists or restores a summary, and the glance reads nothing
// else. Everything is pre-formatted and pre-coloured here, which also keeps the
// grading in one place: the glance used to colour recovery by 70/50 thresholds
// of its own while every card coloured it by the state the server graded
// against the user's bands.
//
// Deliberately NOT (:glance). This is the writer; the glance only needs the key,
// and it carries its own copy of that because Palette and this module cost
// memory it does not have. tests/watchGlanceRender.test.ts keeps the two keys
// equal.
//
module GlanceData {

    const KEY = "glance";

    /** Replace the glance record with one built from `summary`. */
    function write(summary as Dictionary or Null, cachedAt as Number or Null) as Void {
        if (summary == null) { return; }
        try {
            Application.Storage.setValue(KEY, build(summary as Dictionary, cachedAt));
        } catch (ex) {
            // A full store must not take the widget down for the sake of the
            // glance. The glance keeps its previous record, and its age says so.
        }
    }

    function build(summary as Dictionary, cachedAt as Number or Null) as Dictionary {
        var record = { "at" => cachedAt } as Dictionary<String, Object or Null>;

        var finding = topFinding(summary);
        if (finding != null) {
            // A server that writes a glance-length line for the finding gets it
            // used; the headline is a sentence and loses its end on every strip.
            var short = finding.get("short");
            record["f"]  = (short != null && short instanceof String && (short as String).length() > 0)
                ? short
                : finding.get("headline");
            record["fc"] = severityColor(finding.get("severity"));
        }

        var overview = summary.get("daily_overview");
        if (overview != null && overview instanceof Dictionary) {
            var recovery = (overview as Dictionary).get("recovery");
            var sleepH   = (overview as Dictionary).get("sleep_h");
            record["r"]  = recovery == null ? null : metricText(recovery);
            record["rc"] = Palette.forState(stateOf(summary, "recovery"));
            record["s"]  = sleepH == null ? null : metricText(sleepH) + "h";
        }

        return record;
    }

    // The worst finding, when there is enough history for findings to mean
    // anything. The server already ranks them and has already moved muted ones
    // out of this array, so the first one is the one to show.
    function topFinding(summary as Dictionary) as Dictionary or Null {
        var coverage = summary.get("coverage");
        if (coverage == null || !(coverage instanceof Dictionary)) { return null; }
        var ready = (coverage as Dictionary).get("ready");
        if (ready == null || !(ready instanceof Boolean) || !(ready as Boolean)) { return null; }

        var findings = summary.get("findings");
        if (findings == null || !(findings instanceof Array) || (findings as Array).size() == 0) {
            return null;
        }

        var first = (findings as Array)[0];
        if (first == null || !(first instanceof Dictionary)) { return null; }
        var headline = (first as Dictionary).get("headline");
        if (headline == null || !(headline instanceof String)) { return null; }
        return first as Dictionary;
    }

    function stateOf(summary as Dictionary, key as String) as String or Null {
        var states = summary.get("states");
        if (states == null || !(states instanceof Dictionary)) { return null; }
        var value = (states as Dictionary).get(key);
        return (value != null && value instanceof String) ? value as String : null;
    }

    function severityColor(severity as Object or Null) as Number {
        if (severity != null && severity instanceof String) {
            if ((severity as String).equals("warn"))   { return Palette.HARD; }
            if ((severity as String).equals("notice")) { return Palette.CAUTION; }
        }
        return Palette.SECONDARY;
    }

    // Float.toString() renders six decimals, so 6.3 hours of sleep drew as
    // "6.300000h" in a glance slot two characters wide.
    function metricText(value as Object) as String {
        if (value instanceof Float || value instanceof Double) {
            return (value as Float).format("%.1f");
        }
        return value.toString();
    }
}
