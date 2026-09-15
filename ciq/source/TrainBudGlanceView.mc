import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Application;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;

//
// Glance view — the strip shown in the device's glance list.
//
// From API level 4.0.0, an app that does not implement a glance view does not
// appear in the glance list at all, so without this the app is only reachable
// from the full app list.
//
// Glance runs in its own build scope with 32 KB of memory on the Forerunner 55,
// 745 and Instinct 3 and 64 KB elsewhere, so this file is deliberately
// self-contained: it reads one small pre-formatted record out of
// Application.Storage (written by GlanceData in the widget) and does not touch
// the main view, the app class or the network. Everything here carries
// (:glance) so only this code is pulled into that scope.
//
// Every product in the manifest supports glance. fr645 / fr645m did not, and
// were removed in 1.2.0 — they could not meet the manifest's minSdkVersion of
// 3.2.0 either, so a release build including them had never succeeded.
//
(:glance)
class TrainBudGlanceView extends WatchUi.GlanceView {

    // Must match GlanceData.KEY. The glance cannot afford to load that module
    // for one string; tests/watchGlanceRender.test.ts keeps the two equal.
    private const GLANCE_KEY = "glance";

    // Literals, not Rez lookups. The glance runs in its own build scope where
    // the Rez module is not accessible: calling WatchUi.loadResource here throws
    // "Illegal Access (Out of Bounds) - Could not access symbol 'Rez'" and takes
    // the whole glance down. The app is English-only, so nothing is lost.
    private const TITLE       = "TrainBud";
    private const NO_DATA     = "Open to sync";
    private const LABEL_REC   = "Rec";
    private const LABEL_SLEEP = "Sleep";

    // Duplicated from Palette, which the glance scope cannot reach.
    private const SECONDARY = 0x8FA3BD;

    // A margin, not a fix for anything. Four pixels costs nothing on the
    // narrowest product in the manifest and keeps the line off the bezel.
    private const INSET_X = 4;

    // How old the record may be before the title says so. The glance has no
    // way to refresh itself -- it only ever shows what the widget fetched the
    // last time it was opened -- and yesterday's recovery drawn with no date on
    // it reads as today's.
    private const STALE_AFTER_S = 2 * 3600;

    // Read once. Every line measures itself against the screen, several times a
    // draw, and the glance is the scope with the least time to spare.
    private var _screenW as Number = 0;
    private var _round as Boolean = false;
    private var _sub as Graphics.BoundingBox or Null = null;

    function initialize() {
        GlanceView.initialize();
        var settings = System.getDeviceSettings();
        _screenW = settings.screenWidth;
        _round = settings.screenShape == System.SCREEN_SHAPE_ROUND;
        if (WatchUi has :getSubscreen) {
            _sub = WatchUi.getSubscreen();
        }
    }

    function onUpdate(dc as Dc) as Void {
        // Transparent, and only once per update (a second transparent clear in
        // the same update is ignored on device). This used to clear to
        // COLOR_BLACK, which on the Forerunner 70/265, Venu 3 and fenix 8
        // painted a flat black rectangle over the themed card those devices draw
        // behind the focused glance.
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.clear();

        var height = dc.getHeight();

        var record = readRecord();

        var titleH  = dc.getFontHeight(Graphics.FONT_GLANCE);
        var textH   = titleH;
        var numberH = dc.getFontHeight(Graphics.FONT_GLANCE_NUMBER);
        var rowH    = numberH > textH ? numberH : textH;

        // Work out what the body is before placing anything, so the title and
        // the body are centred as one block. They used to sit on the top and
        // bottom edges of the strip -- on the Forerunner 70's 125 px glance that
        // left a gap wide enough for another line between them, while the title
        // was drawn hard against the top.
        var findingText = record == null ? null : record.get("f");
        var lines = null as Array<String> or Null;
        var dotRadius = 3;
        var dotGap = 5;
        var bodyH = rowH;

        var recText   = record == null ? "--" : textOr(record.get("r"), "--");
        var sleepText = record == null ? "--" : textOr(record.get("s"), "--");
        var gap       = dc.getTextWidthInPixels("  ", Graphics.FONT_GLANCE);
        var metricMode = METRICS_ROW;

        if (findingText != null && findingText instanceof String) {
            // One line if it fits where one line would sit; otherwise two, each
            // measured against the width available at its own height.
            var oneTop = blockTop(height, titleH + textH);
            var oneY = oneTop + titleH + (textH / 2);
            var oneX = blockLeft(dc, oneTop, titleH) + (dotRadius * 2) + dotGap;
            lines = [findingText as String];
            if (dc.getTextWidthInPixels(findingText as String, Graphics.FONT_GLANCE) > rightLimit(dc, oneY) - oneX) {
                if (fitsTall(height, titleH + (textH * 2))) {
                    var twoTop = blockTop(height, titleH + (textH * 2));
                    var y1 = twoTop + titleH + (textH / 2);
                    var twoX = blockLeft(dc, twoTop, titleH) + (dotRadius * 2) + dotGap;
                    lines = wrapTwo(dc, findingText as String,
                        rightLimit(dc, y1) - twoX, rightLimit(dc, y1 + textH) - twoX);
                } else {
                    lines = [ellipsize(dc, findingText as String, Graphics.FONT_GLANCE, rightLimit(dc, oneY) - oneX)];
                }
            }
            bodyH = textH * lines.size();
        } else if (record == null) {
            bodyH = textH;
        } else {
            // Recovery and sleep side by side when they fit. On the Forerunner
            // 70 they do not -- the top of a round screen is narrower than the
            // strip -- and "Rec 62Sleep 6.3h" ran into itself and under the
            // bezel. Next best is dropping the Sleep label, since "6.3h" beside
            // a recovery score still reads as sleep; stacking comes last,
            // because three lines fill a tall strip to its edges.
            var oneTop = blockTop(height, titleH + rowH);
            var oneY = oneTop + titleH + (rowH / 2);
            var oneLeft = blockLeft(dc, oneTop, titleH);
            var oneLimit = rightLimit(dc, oneY);
            var recW = metricWidth(dc, LABEL_REC, recText);
            if (oneLeft + recW + gap + metricWidth(dc, LABEL_SLEEP, sleepText) > oneLimit) {
                if (oneLeft + recW + gap + metricWidth(dc, "", sleepText) <= oneLimit) {
                    metricMode = METRICS_NO_SLEEP_LABEL;
                } else if (fitsTall(height, titleH + (rowH * 2))) {
                    metricMode = METRICS_STACKED;
                    bodyH = rowH * 2;
                } else {
                    metricMode = METRICS_NO_SLEEP_LABEL;
                }
            }
        }

        var top = blockTop(height, titleH + bodyH);
        var left = blockLeft(dc, top, titleH);

        // The title is drawn whatever the record holds, so a missing or
        // malformed record still leaves the strip naming the app.
        drawTitle(dc, left, top, titleH, record);

        var bodyTop = top + titleH;

        if (record == null) {
            dc.setColor(SECONDARY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(left, bodyTop + (textH / 2), Graphics.FONT_GLANCE, NO_DATA,
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        // The watch is a widget with no background service, so nothing here can
        // be pushed to -- a flag is only ever seen because the user happened to
        // scroll past. That makes this strip the only proactive surface the app
        // has, so when something stands out it takes the space the numbers
        // would have used. The numbers are one tap away; the flag is not.
        if (lines != null) {
            // A dot carries the severity and the sentence stays white, the same
            // rule the cards follow: a whole line in the severity colour is the
            // least legible thing this app can draw on a transflective screen.
            var color = record.get("fc");
            dc.setColor(color instanceof Number ? color as Number : SECONDARY, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(left + dotRadius, bodyTop + (textH / 2), dotRadius);

            var textX = left + (dotRadius * 2) + dotGap;
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            for (var i = 0; i < lines.size(); i += 1) {
                dc.drawText(textX, bodyTop + (textH * i) + (textH / 2), Graphics.FONT_GLANCE,
                    lines[i], Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            }
            return;
        }

        var recColor  = record.get("rc");
        var rowY      = bodyTop + (rowH / 2);

        drawMetric(dc, left, rowY, LABEL_REC, recText,
            recColor instanceof Number ? recColor as Number : Graphics.COLOR_WHITE);

        if (metricMode == METRICS_STACKED) {
            drawMetric(dc, left, rowY + rowH, LABEL_SLEEP, sleepText, Graphics.COLOR_WHITE);
            return;
        }

        // Sleep is right-aligned to the edge actually visible at this height,
        // rather than started at the halfway mark: "Sleep 7.2h" is wider than
        // half a glance on every product here.
        var sleepLabel = metricMode == METRICS_NO_SLEEP_LABEL ? "" : LABEL_SLEEP;
        var limit  = rightLimit(dc, rowY);
        var sleepW = metricWidth(dc, sleepLabel, sleepText);
        var recEnd = left + metricWidth(dc, LABEL_REC, recText) + gap;
        var sleepX = limit - sleepW;
        if (sleepX < recEnd) {
            // Still no room: the recovery score is the one worth keeping.
            if (recEnd + sleepW > limit) { return; }
            sleepX = recEnd;
        }

        drawMetric(dc, sleepX, rowY, sleepLabel, sleepText, Graphics.COLOR_WHITE);
    }

    private const METRICS_ROW            = 0;
    private const METRICS_STACKED        = 1;
    private const METRICS_NO_SLEEP_LABEL = 2;

    //
    // Whether a three-line block fits without touching the top of the strip.
    //
    // On a round screen the strip's top corners are under the bezel. The
    // fenix 8's 130 px glance holds three 40 px lines with 5 px to spare, and
    // the title that landed in those 5 px lost the left of its "T". A shorter
    // body in the middle of the strip beats a longer one drawn under the case.
    //
    private function fitsTall(height as Number, blockH as Number) as Boolean {
        var margin = _round ? 20 : 0;
        return height >= blockH + margin;
    }

    //
    // The left edge for a block whose title starts at `top`.
    //
    // The mirror of rightLimit, for the fenix 8: its glance starts 82 px in on a
    // 454 px screen, and a title near the top of the strip lost the left of its
    // "T" under the round edge. Measured a third of the way down the title,
    // where its capitals begin, and used for every line below it -- lower lines
    // only have more room.
    //
    // Here the conservative guess is the other way round: the strip is assumed
    // to start as far LEFT as any glance in the manifest does relative to its
    // right-hand gap (23 px, the fenix 8), and at the very top of the screen.
    //
    private function blockLeft(dc as Dc, top as Number, titleH as Number) as Number {
        if (!_round) { return INSET_X; }

        var screenW = _screenW;
        var r = screenW / 2;
        var dy = r - (top + (titleH / 3));
        if (dy <= 0) { return INSET_X; }

        var half = Math.sqrt(r * r - dy * dy).toNumber();
        var stripX = screenW - dc.getWidth() - 23;
        var left = (r - half) - stripX + 2;
        return left > INSET_X ? left : INSET_X;
    }

    private function blockTop(height as Number, blockH as Number) as Number {
        var top = (height - blockH) / 2;
        return top < 0 ? 0 : top;
    }

    //
    // The right-most x text may reach on a line centred at `y`.
    //
    // The Dc reports a rectangle, and on a round screen the top of that
    // rectangle runs under the bezel: in the simulator the first line of a
    // wrapped finding lost its last letters ("Resting HR 4 bp") on the
    // Forerunner 70, and "Sleep 6.3h" lost its "h" on the Forerunner 55, while
    // the width the Dc reported said both fit. On the Instinct 3 Solar the round
    // sub-display sits over the right of the strip instead and hid "Sleep"
    // entirely.
    //
    // The Dc says nothing about where it is on the screen, so the strip is
    // assumed to start at the very top and reach the screen's right edge. Every
    // glance in the manifest sits lower and stops short of the edge, so this
    // errs towards a shorter line, never a clipped one -- on a device that
    // draws the focused glance mid-screen, the cost is a few pixels of margin.
    //
    private function rightLimit(dc as Dc, y as Number) as Number {
        var width = dc.getWidth();
        var limit = width - INSET_X;
        var screenW = _screenW;

        if (_round) {
            var r = screenW / 2;
            var dy = r - y;
            if (dy > 0) {
                var half = Math.sqrt(r * r - dy * dy).toNumber();
                var round = width - screenW + r + half - INSET_X;
                if (round < limit) { limit = round; }
            }
        }

        var sub = _sub;
        if (sub != null) {
            if (y < sub.y + sub.height) {
                // The lens has a ring around it that getSubscreen() does not
                // include; text ending right at sub.x still ran under it.
                var beside = sub.x - (screenW - width) - INSET_X - 8;
                if (beside < limit) { limit = beside; }
            }
        }

        return limit;
    }

    // The app name, and how old the numbers are once that matters.
    private function drawTitle(dc as Dc, x as Number, y as Number, titleH as Number, record as Dictionary or Null) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_GLANCE, TITLE, Graphics.TEXT_JUSTIFY_LEFT);

        var age = record == null ? null : ageText(record.get("at"));
        if (age == null) { return; }

        var titleEnd = x + dc.getTextWidthInPixels(TITLE + "  ", Graphics.FONT_GLANCE);
        var room = rightLimit(dc, y + (titleH / 2)) - titleEnd;
        var label = (age as String) + " ago";
        if (dc.getTextWidthInPixels(label, Graphics.FONT_GLANCE) > room) {
            label = age as String;
            if (dc.getTextWidthInPixels(label, Graphics.FONT_GLANCE) > room) { return; }
        }

        dc.setColor(SECONDARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(titleEnd, y, Graphics.FONT_GLANCE, label, Graphics.TEXT_JUSTIFY_LEFT);
    }

    /** "3h" or "2d" when the record is old enough to say so; null when fresh. */
    private function ageText(at as Object or Null) as String or Null {
        if (at == null || !(at instanceof Number)) { return null; }
        var seconds = Time.now().value() - (at as Number);
        if (seconds < STALE_AFTER_S) { return null; }
        if (seconds < 86400) { return (seconds / 3600).toString() + "h"; }
        return (seconds / 86400).toString() + "d";
    }

    //
    // A headline is a sentence and a glance line is a handful of characters.
    //
    // It used to be cut to one line with an ellipsis, which on the Forerunner 70
    // left "Resting HR 4 bp..." -- the part that says what changed, gone. Where
    // the strip is tall enough for a second line, the sentence wraps at a word
    // and only what still does not fit is elided.
    //
    private function wrapTwo(dc as Dc, text as String, firstWidth as Number, secondWidth as Number) as Array<String> {
        var font = Graphics.FONT_GLANCE;
        var fits = longestFit(dc, text, font, firstWidth, "");
        var cut = fits;
        var chars = text.toCharArray();
        // Back off to the last space inside what fits, unless that would leave
        // the first line nearly empty -- then a mid-word break reads better
        // than a one-word line.
        for (var i = fits; i > fits / 2; i -= 1) {
            if (i < chars.size() && chars[i] == ' ') { cut = i; break; }
        }

        var first = text.substring(0, cut);
        var rest = text.substring(cut, text.length());
        while (rest.length() > 0 && rest.substring(0, 1).equals(" ")) {
            rest = rest.substring(1, rest.length());
        }
        if (rest.length() == 0) { return [first]; }
        return [first, ellipsize(dc, rest, font, secondWidth)];
    }

    private function ellipsize(dc as Dc, text as String, font as Graphics.FontDefinition, maxWidth as Number) as String {
        if (dc.getTextWidthInPixels(text, font) <= maxWidth) { return text; }
        var n = longestFit(dc, text, font, maxWidth, "...");
        if (n < 1) { return "..."; }
        return text.substring(0, n) + "...";
    }

    // The most leading characters of `text` that fit with `suffix` after them.
    //
    // A binary search. This trimmed one character at a time and measured the
    // string after every trim -- forty-odd native calls and as many string
    // allocations for one headline, in the scope that has the least memory and
    // the tightest time budget of anything this app runs.
    private function longestFit(dc as Dc, text as String, font as Graphics.FontDefinition, maxWidth as Number, suffix as String) as Number {
        var lo = 0;
        var hi = text.length();
        while (lo < hi) {
            var mid = (lo + hi + 1) / 2;
            if (dc.getTextWidthInPixels(text.substring(0, mid) + suffix, font) <= maxWidth) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    private function textOr(value as Object or Null, fallback as String) as String {
        return (value != null && value instanceof String) ? value as String : fallback;
    }

    private function drawMetric(
        dc as Dc,
        x as Number,
        y as Number,
        label as String,
        value as String,
        valueColor as Number
    ) as Void {
        var labelWidth = 0;
        if (label.length() > 0) {
            dc.setColor(SECONDARY, Graphics.COLOR_TRANSPARENT);
            labelWidth = dc.getTextWidthInPixels(label + " ", Graphics.FONT_GLANCE);
            dc.drawText(x, y, Graphics.FONT_GLANCE, label,
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // FONT_GLANCE_NUMBER carries digits and separators and no letters at
        // all, so the "h" in "6.3h" draws as a missing-glyph box. Offer the
        // number face only when there is nothing but a number.
        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x + labelWidth, y, valueFont(value), value,
            Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    /** How wide a label and value pair draws, in the faces it will actually
        be drawn in. */
    private function metricWidth(dc as Dc, label as String, value as String) as Number {
        var labelWidth = label.length() > 0 ? dc.getTextWidthInPixels(label + " ", Graphics.FONT_GLANCE) : 0;
        return labelWidth + dc.getTextWidthInPixels(value, valueFont(value));
    }

    private function valueFont(value as String) as Graphics.FontDefinition {
        return isNumericText(value) ? Graphics.FONT_GLANCE_NUMBER : Graphics.FONT_GLANCE;
    }

    /** True when every character is one the FONT_GLANCE_NUMBER face actually
        has: digits, and the separators that appear between them. */
    private function isNumericText(text as String) as Boolean {
        var chars = text.toCharArray();
        for (var i = 0; i < chars.size(); i += 1) {
            var c = chars[i];
            var isDigit = c >= '0' && c <= '9';
            var isSep   = c == '.' || c == ':' || c == '-' || c == ' ' || c == ',';
            if (!isDigit && !isSep) { return false; }
        }
        return true;
    }

    // The record GlanceData wrote on the widget's last fetch, or null when there
    // is none yet -- including right after updating from 2.0.3, which kept only
    // the full summary. Opening the widget once writes it.
    private function readRecord() as Dictionary or Null {
        var stored = Application.Storage.getValue(GLANCE_KEY);
        return (stored != null && stored instanceof Dictionary) ? stored as Dictionary : null;
    }
}
