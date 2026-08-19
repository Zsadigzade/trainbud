import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Application;

//
// Glance view — the strip shown in the device's glance list.
//
// From API level 4.0.0, an app that does not implement a glance view does not
// appear in the glance list at all, so without this the app is only reachable
// from the full app list.
//
// Glance runs in its own build scope with roughly 32-64 KB of memory depending
// on the device, so this file is deliberately self-contained: it reads the
// cached summary straight out of Application.Storage and does not touch the
// main view, the app class or the network. Everything here carries (:glance)
// so only this code is pulled into that scope.
//
// Every product in the manifest supports glance. fr645 / fr645m did not, and
// were removed in 1.2.0 — they could not meet the manifest's minSdkVersion of
// 3.2.0 either, so a release build including them had never succeeded.
//
(:glance)
class TrainBudGlanceView extends WatchUi.GlanceView {

    // Must match STORAGE_SUMMARY_KEY in TrainBudApp.
    private const STORAGE_SUMMARY_KEY = "summary";

    // Literals, not Rez lookups. The glance runs in its own build scope where
    // the Rez module is not accessible: calling WatchUi.loadResource here throws
    // "Illegal Access (Out of Bounds) - Could not access symbol 'Rez'" and takes
    // the whole glance down. The app is English-only, so nothing is lost.
    private const TITLE       = "TrainBud";
    private const NO_DATA     = "Open to sync";
    private const LABEL_REC   = "Rec";
    private const LABEL_SLEEP = "Sleep";

    function initialize() {
        GlanceView.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_TRANSPARENT, Graphics.COLOR_BLACK);
        dc.clear();

        var width  = dc.getWidth();
        var height = dc.getHeight();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            0, 0,
            Graphics.FONT_GLANCE,
            TITLE,
            Graphics.TEXT_JUSTIFY_LEFT
        );

        var overview = readOverview();
        if (overview == null) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(
                0, height / 2,
                Graphics.FONT_GLANCE,
                NO_DATA,
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER
            );
            return;
        }

        var recovery = overview.get("recovery");
        var sleepH   = overview.get("sleep_h");

        var baseline = height - 2;

        // Recovery — left half, coloured by threshold.
        drawMetric(
            dc,
            0,
            baseline,
            LABEL_REC,
            recovery == null ? "--" : metricText(recovery),
            recoveryColor(recovery)
        );

        // Sleep — right half.
        drawMetric(
            dc,
            width / 2,
            baseline,
            LABEL_SLEEP,
            sleepH == null ? "--" : metricText(sleepH) + "h",
            Graphics.COLOR_WHITE
        );
    }

    // Float.toString() renders six decimals, so 6.3 hours of sleep drew as
    // "6.300000h" in a glance slot two characters wide.
    private function metricText(value) as String {
        if (value instanceof Float || value instanceof Double) {
            return (value as Float).format("%.1f");
        }
        return value.toString();
    }

    private function drawMetric(
        dc as Dc,
        x as Number,
        baseline as Number,
        label as String,
        value as String,
        valueColor as Number
    ) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        var labelWidth = dc.getTextWidthInPixels(label + " ", Graphics.FONT_GLANCE);
        dc.drawText(
            x, baseline,
            Graphics.FONT_GLANCE, label,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER
        );

        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            x + labelWidth, baseline,
            Graphics.FONT_GLANCE_NUMBER, value,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }

    // Reads the cached daily_overview written by the main view's last fetch.
    // Returns null when nothing has been cached yet, or the cache is not the
    // shape we expect.
    private function readOverview() as Dictionary or Null {
        var stored = Application.Storage.getValue(STORAGE_SUMMARY_KEY);
        if (stored == null || !(stored instanceof Dictionary)) {
            return null;
        }

        var overview = (stored as Dictionary).get("daily_overview");
        if (overview == null || !(overview instanceof Dictionary)) {
            return null;
        }

        return overview as Dictionary;
    }

    // Kept in sync with TrainBudView.recoveryColor.
    private function recoveryColor(score as Object or Null) as Number {
        if (score == null || !(score instanceof Number)) {
            return Graphics.COLOR_WHITE;
        }
        var value = score as Number;
        if (value >= 70) { return Graphics.COLOR_GREEN; }
        if (value >= 50) { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }
}
