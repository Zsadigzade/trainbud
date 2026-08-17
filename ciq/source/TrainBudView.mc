import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class GarminBudView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var app = Application.getApp() as GarminBudApp;
        app.fetchSummary();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var app = Application.getApp() as GarminBudApp;
        var status = app.getStatus();

        // Pairing screens
        if (status.equals("pairing_request")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.Loading) as String);
            return;
        }

        if (status.equals("pairing")) {
            drawPairingScreen(dc, app);
            return;
        }

        if (status.equals("pairing_error")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.PairingError) as String);
            return;
        }

        if (status.equals("config")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.ConfigError) as String);
            return;
        }

        if (status.equals("loading")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.Loading) as String);
            return;
        }

        if (status.equals("error")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.FetchError) as String);
            return;
        }

        var cardIndex = app.getCardIndex();

        // Ask AI menu (card 8)
        if (cardIndex == 8) {
            var promptStatus = app.getPromptStatus();
            if (promptStatus.equals("idle")) {
                drawAskAiMenu(dc, app);
            } else if (promptStatus.equals("submitting") || promptStatus.equals("waiting")) {
                drawMessage(dc, WatchUi.loadResource(Rez.Strings.AiThinking) as String);
            } else if (promptStatus.equals("done")) {
                drawPromptResult(dc, app);
            } else {
                drawMessage(dc, WatchUi.loadResource(Rez.Strings.AiError) as String);
            }
            return;
        }

        drawCard(dc, cardIndex, app.getSummary(), isRoundScreen(dc));

        if (status.equals("stale")) {
            drawStaleIndicator(dc, app.getCachedAt());
        }

        drawHint(dc);
    }

    // -------------------------------------------------------------------------
    // Pairing screen
    // -------------------------------------------------------------------------

    private function drawPairingScreen(dc as Dc, app as GarminBudApp) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.PairingTitle) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var code = app.getPairCode();
        if (code != null) {
            // Format as "12 34 56" for readability
            var formatted = "";
            var c = code as String;
            if (c.length() == 6) {
                formatted = c.substring(0, 2) + " " + c.substring(2, 4) + " " + c.substring(4, 6);
            } else {
                formatted = c;
            }

            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy - 16, Graphics.FONT_NUMBER_HOT, formatted,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy + 28, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.PairingInstructions) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        dc.drawText(cx, dc.getHeight() - 8, Graphics.FONT_XTINY,
            "/dashboard",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // -------------------------------------------------------------------------
    // Ask AI menu
    // -------------------------------------------------------------------------

    private function drawAskAiMenu(dc as Dc, app as GarminBudApp) as Void {
        var cx = dc.getWidth() / 2;
        var w  = dc.getWidth();
        var h  = dc.getHeight();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardAskAi) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var idx    = app.getAskMenuIndex();
        var count  = app.PROMPT_COUNT;

        // Draw prev/next prompts faded, current highlighted
        var prompts = new [count] as Array<String>;
        for (var i = 0; i < count; i += 1) {
            prompts[i] = app.getPromptText(i);
        }

        var midY = h / 2;

        // Current item
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, midY, Graphics.FONT_TINY,
            truncate(prompts[idx], 26),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Prev item (faded)
        if (idx > 0) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, midY - 28, Graphics.FONT_XTINY,
                truncate(prompts[idx - 1], 28),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Next item (faded)
        if (idx < count - 1) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, midY + 28, Graphics.FONT_XTINY,
                truncate(prompts[idx + 1], 28),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Selection dots
        var dotY = h - 16;
        var dotSpacing = 12;
        var startX = cx - ((count - 1) * dotSpacing) / 2;
        for (var i = 0; i < count; i += 1) {
            if (i == idx) {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(startX + i * dotSpacing, dotY, 4);
            } else {
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(startX + i * dotSpacing, dotY, 3);
            }
        }

        // Tap hint
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w - 8, midY, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.AskSelectHint) as String,
            Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // -------------------------------------------------------------------------
    // Prompt result
    // -------------------------------------------------------------------------

    private function drawPromptResult(dc as Dc, app as GarminBudApp) as Void {
        var cx   = dc.getWidth() / 2;
        var cy   = dc.getHeight() / 2;
        var page = app.getPromptPageIndex();
        var pages = app.getPromptPageCount();
        var text  = app.getPromptPage(page);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 16, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.ResultPrefix) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy, Graphics.FONT_XTINY, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if (pages > 1) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, dc.getHeight() - 8, Graphics.FONT_XTINY,
                (page + 1).toString() + "/" + pages.toString(),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Shared helpers
    // -------------------------------------------------------------------------

    private function isRoundScreen(dc as Dc) as Boolean {
        return dc.getWidth() == dc.getHeight() && dc.getWidth() >= 240;
    }

    private function drawMessage(dc as Dc, message as String) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            dc.getWidth() / 2, dc.getHeight() / 2,
            Graphics.FONT_SMALL, message,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }

    private function drawHint(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(
            dc.getWidth() / 2, dc.getHeight() - 4,
            Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.TapHint) as String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
    }

    private function drawStaleIndicator(dc as Dc, cachedAt as Number or Null) as Void {
        if (cachedAt == null) { return; }

        var minutesAgo = ((Time.now().value() - cachedAt) / 60).toNumber();
        if (minutesAgo < 1) { minutesAgo = 1; }

        var staleText = WatchUi.loadResource(Rez.Strings.StalePrefix) as String + " " +
            minutesAgo.toString() + "m " +
            WatchUi.loadResource(Rez.Strings.StaleSuffix) as String;

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 12, Graphics.FONT_XTINY, staleText, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // -------------------------------------------------------------------------
    // Card routing
    // -------------------------------------------------------------------------

    private function drawCard(
        dc as Dc,
        cardIndex as Number,
        summary as Dictionary or Null,
        roundScreen as Boolean
    ) as Void {
        if (cardIndex == 0) { drawOverviewCard(dc, summary); return; }
        if (cardIndex == 1) { drawRecoveryCard(dc, summary, roundScreen); return; }
        if (cardIndex == 7) { drawAiInsightCard(dc, summary); return; }

        var title      = getCardTitle(cardIndex);
        var value      = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var subtitle   = "";
        var valueColor = Graphics.COLOR_WHITE;

        if (summary != null) {
            var cardData = getCardData(cardIndex, summary);
            value      = cardData[:value] as String;
            subtitle   = cardData[:subtitle] as String;
            valueColor = cardData[:color] as Number;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 28, Graphics.FONT_SMALL, title, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2 - 8, Graphics.FONT_NUMBER_HOT,
            value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if ((subtitle as String).length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2 + 36, Graphics.FONT_TINY,
                subtitle, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // -------------------------------------------------------------------------
    // AI Insight card (card 7)
    // -------------------------------------------------------------------------

    private function drawAiInsightCard(dc as Dc, summary as Dictionary or Null) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardAiInsight) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var insight = WatchUi.loadResource(Rez.Strings.AiNoInsight) as String;
        if (summary != null) {
            var ai = summary.get("ai_insight");
            if (ai != null && ai instanceof String) {
                insight = ai as String;
            }
        }

        // Wrap text: split into ~22-char lines for small watch
        var lines = wrapText(insight, 22);
        var lineH = 20;
        var startY = cy - ((lines.size() - 1) * lineH) / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < lines.size(); i += 1) {
            dc.drawText(cx, startY + i * lineH, Graphics.FONT_XTINY,
                lines[i] as String, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Overview card
    // -------------------------------------------------------------------------

    private function drawOverviewCard(dc as Dc, summary as Dictionary or Null) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 24, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardOverview) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var recValue   = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var sleepValue = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var stressValue = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var vo2Value   = WatchUi.loadResource(Rez.Strings.NoData) as String;

        if (summary != null) {
            var overview = summary.get("daily_overview");
            if (overview != null && overview instanceof Dictionary) {
                var ov = overview as Dictionary;
                var recovery = ov.get("recovery");
                if (recovery != null) { recValue = recovery.toString(); }
                var sleepH = ov.get("sleep_h");
                if (sleepH != null) { sleepValue = sleepH.toString() + "h"; }
                var stress = ov.get("stress");
                if (stress != null) { stressValue = stress.toString(); }
                var vo2 = ov.get("vo2max");
                if (vo2 != null) { vo2Value = vo2.toString(); }
            }
        }

        var leftX   = dc.getWidth() / 4;
        var rightX  = (dc.getWidth() * 3) / 4;
        var topY    = dc.getHeight() / 2 - 24;
        var bottomY = dc.getHeight() / 2 + 18;

        drawOverviewCell(dc, leftX,  topY,    WatchUi.loadResource(Rez.Strings.LabelRecovery) as String, recValue,    recoveryColor(parseNumber(recValue)));
        drawOverviewCell(dc, rightX, topY,    WatchUi.loadResource(Rez.Strings.LabelSleep) as String,    sleepValue,  Graphics.COLOR_WHITE);
        drawOverviewCell(dc, leftX,  bottomY, WatchUi.loadResource(Rez.Strings.LabelStress) as String,   stressValue, stressColor(parseNumber(stressValue)));
        drawOverviewCell(dc, rightX, bottomY, WatchUi.loadResource(Rez.Strings.LabelVo2) as String,      vo2Value,    Graphics.COLOR_WHITE);
    }

    private function drawOverviewCell(dc as Dc, x as Number, y as Number, label as String, value as String, valueColor as Number) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + 18, Graphics.FONT_MEDIUM, value, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // -------------------------------------------------------------------------
    // Recovery card
    // -------------------------------------------------------------------------

    private function drawRecoveryCard(dc as Dc, summary as Dictionary or Null, roundScreen as Boolean) as Void {
        var score    = 0;
        var label    = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var hasScore = false;

        if (summary != null) {
            var recovery = summary.get("recovery");
            if (recovery != null && recovery instanceof Dictionary) {
                var rd = recovery as Dictionary;
                var sv = rd.get("score");
                var lv = rd.get("label");
                if (sv != null) { score = sv as Number; hasScore = true; }
                if (lv != null) { label = lv as String; }
            }
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 24, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardRecovery) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var color = recoveryColor(hasScore ? score : null);
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        if (roundScreen && hasScore) {
            var radius = (dc.getWidth() / 2) - 36;
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, radius, Graphics.ARC_COUNTER_CLOCKWISE, 90, 90 - 360);
            var endAngle = 90 - ((score * 360) / 100);
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, radius, Graphics.ARC_COUNTER_CLOCKWISE, 90, endAngle);
        } else if (hasScore) {
            var barWidth = dc.getWidth() - 40;
            var fillWidth = (barWidth * score) / 100;
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(20, cy + 8, barWidth, 8);
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(20, cy + 8, fillWidth, 8);
        }

        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 8, Graphics.FONT_NUMBER_HOT,
            hasScore ? score.toString() : WatchUi.loadResource(Rez.Strings.NoData) as String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if ((label as String).length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 36, Graphics.FONT_TINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Card titles & data
    // -------------------------------------------------------------------------

    private function getCardTitle(cardIndex as Number) as String {
        if (cardIndex == 2) { return WatchUi.loadResource(Rez.Strings.CardSleep) as String; }
        if (cardIndex == 3) { return WatchUi.loadResource(Rez.Strings.CardActivity) as String; }
        if (cardIndex == 4) { return WatchUi.loadResource(Rez.Strings.CardStress) as String; }
        if (cardIndex == 5) { return WatchUi.loadResource(Rez.Strings.CardVo2Max) as String; }
        return WatchUi.loadResource(Rez.Strings.CardHeartRate) as String;
    }

    private function getCardData(cardIndex as Number, summary as Dictionary) as Dictionary {
        var result = {
            :value    => WatchUi.loadResource(Rez.Strings.NoData) as String,
            :subtitle => "",
            :color    => Graphics.COLOR_WHITE
        };

        if (cardIndex == 2) {
            var sleep = summary.get("sleep");
            if (sleep != null && sleep instanceof Dictionary) {
                var sd = sleep as Dictionary;
                var hours = sd.get("hours");
                var score = sd.get("score");
                var lbl   = sd.get("label");
                if (hours != null) { result[:value] = hours.toString() + "h"; }
                if (score != null) {
                    result[:subtitle] = "Score " + score.toString();
                    result[:color]    = sleepColor(score as Number);
                } else if (lbl != null) {
                    result[:subtitle] = lbl as String;
                }
            }
            return result;
        }

        if (cardIndex == 3) {
            var activity = summary.get("activity");
            if (activity != null && activity instanceof Dictionary) {
                var ad = activity as Dictionary;
                var name     = ad.get("name");
                var distance = ad.get("distance_km");
                var dur      = ad.get("duration_min");
                var avgHr    = ad.get("avg_hr");
                var parts    = [] as Array<String>;
                if (name != null) { result[:value] = truncate(name as String, 14); }
                if (dur != null)      { parts.add(formatDuration(dur as Number)); }
                if (distance != null) { parts.add(distance.toString() + " km"); }
                if (avgHr != null)    { parts.add(avgHr.toString() + " bpm"); }
                result[:subtitle] = joinParts(parts, " · ");
            }
            return result;
        }

        if (cardIndex == 4) {
            var stress = summary.get("stress");
            if (stress != null && stress instanceof Dictionary) {
                var sd = stress as Dictionary;
                var avg = sd.get("avg");
                var lbl = sd.get("label");
                if (avg != null) { result[:value] = avg.toString(); result[:color] = stressColor(avg as Number); }
                if (lbl != null) { result[:subtitle] = lbl as String; }
            }
            return result;
        }

        if (cardIndex == 5) {
            var vo2max = summary.get("vo2max");
            if (vo2max != null && vo2max instanceof Dictionary) {
                var vd    = vo2max as Dictionary;
                var value = vd.get("value");
                var trend = vd.get("trend");
                if (value != null) { result[:value] = value.toString(); }
                if (trend != null) { result[:subtitle] = trend as String; }
            }
            return result;
        }

        var heartRate = summary.get("heart_rate");
        if (heartRate != null && heartRate instanceof Dictionary) {
            var hd      = heartRate as Dictionary;
            var resting = hd.get("resting");
            var max     = hd.get("max");
            if (resting != null) {
                result[:value] = resting.toString();
                result[:color] = heartRateColor(resting as Number);
            }
            result[:subtitle] = max != null
                ? WatchUi.loadResource(Rez.Strings.LabelMax) as String + " " + max.toString()
                : WatchUi.loadResource(Rez.Strings.LabelResting) as String;
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Color helpers
    // -------------------------------------------------------------------------

    private function recoveryColor(score as Number or Null) as Number {
        if (score == null) { return Graphics.COLOR_WHITE; }
        if (score >= 70)   { return Graphics.COLOR_GREEN; }
        if (score >= 50)   { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }

    private function sleepColor(score as Number or Null) as Number {
        if (score == null) { return Graphics.COLOR_WHITE; }
        if (score >= 80)   { return Graphics.COLOR_GREEN; }
        if (score >= 60)   { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }

    private function stressColor(avg as Number or Null) as Number {
        if (avg == null) { return Graphics.COLOR_WHITE; }
        if (avg <= 25)   { return Graphics.COLOR_GREEN; }
        if (avg <= 50)   { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }

    private function heartRateColor(resting as Number) as Number {
        if (resting < 60)  { return Graphics.COLOR_GREEN; }
        if (resting <= 80) { return Graphics.COLOR_YELLOW; }
        return Graphics.COLOR_RED;
    }

    // -------------------------------------------------------------------------
    // Text helpers
    // -------------------------------------------------------------------------

    private function parseNumber(text as String) as Number or Null {
        var noData = WatchUi.loadResource(Rez.Strings.NoData) as String;
        if (text.equals(noData)) { return null; }

        var digits = "";
        for (var i = 0; i < text.length(); i += 1) {
            var ch = text.substring(i, i + 1);
            if (ch.equals("0") || ch.equals("1") || ch.equals("2") || ch.equals("3") ||
                ch.equals("4") || ch.equals("5") || ch.equals("6") || ch.equals("7") ||
                ch.equals("8") || ch.equals("9")) {
                digits += ch;
            } else {
                break;
            }
        }
        if (digits.length() == 0) { return null; }
        return digits.toNumber();
    }

    private function formatDuration(minutes as Number) as String {
        if (minutes >= 60) {
            var hours = minutes / 60;
            var mins  = minutes % 60;
            return hours.toNumber().toString() + "h " + mins.toString() + "m";
        }
        return minutes.toString() + "m";
    }

    private function joinParts(parts as Array<String>, separator as String) as String {
        var result = "";
        for (var i = 0; i < parts.size(); i += 1) {
            if (i > 0) { result += separator; }
            result += parts[i];
        }
        return result;
    }

    private function truncate(text as String, maxLen as Number) as String {
        if (text.length() <= maxLen) { return text; }
        return text.substring(0, maxLen - 3) + "...";
    }

    private function wrapText(text as String, maxChars as Number) as Array<String> {
        var lines = [] as Array<String>;
        var remaining = text;

        while (remaining.length() > maxChars) {
            var breakAt = maxChars;
            // Walk back to find a space
            while (breakAt > 0 && !remaining.substring(breakAt - 1, breakAt).equals(" ")) {
                breakAt -= 1;
            }
            if (breakAt == 0) { breakAt = maxChars; }
            lines.add(remaining.substring(0, breakAt));
            remaining = remaining.substring(breakAt, remaining.length());
            if (remaining.length() > 0 && remaining.substring(0, 1).equals(" ")) {
                remaining = remaining.substring(1, remaining.length());
            }
        }

        if (remaining.length() > 0) {
            lines.add(remaining);
        }

        if (lines.size() == 0) {
            lines.add("");
        }

        return lines;
    }
}
