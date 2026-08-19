import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class TrainBudView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var app = Application.getApp() as TrainBudApp;
        app.fetchSummary();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        var app = Application.getApp() as TrainBudApp;
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
            drawPairingError(dc, app);
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

        // Ask AI menu
        if (cardIndex == Cards.ASK_AI) {
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

        drawPageDots(dc, cardIndex, app.getCardCount());
    }

    // -------------------------------------------------------------------------
    // Pairing screen
    // -------------------------------------------------------------------------

    private function drawPairingScreen(dc as Dc, app as TrainBudApp) as Void {
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

        // Poll telemetry: attempts made and the last response code. A stalled
        // pairing otherwise looks the same whether the poll is being refused on
        // the device or the code simply has not been approved yet.
        var attempts = app.getPairPollAttempts();
        var polls = app.getPairPollCount();
        var pollCode = app.getPairPollCode();
        dc.drawText(cx, dc.getHeight() - 8, Graphics.FONT_XTINY,
            attempts.toString() + "/" + polls.toString()
                + (pollCode == null ? "" : " " + pollCode.toString()),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    // -------------------------------------------------------------------------
    // Ask AI menu
    // -------------------------------------------------------------------------

    private function drawAskAiMenu(dc as Dc, app as TrainBudApp) as Void {
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

    private function drawPromptResult(dc as Dc, app as TrainBudApp) as Void {
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

    // Shows the transport/HTTP code alongside the message. Connect IQ reports
    // "no phone connection" as -104 and a request timeout as -400, and without
    // the number on screen those are indistinguishable from a server fault.
    private function drawPairingError(dc as Dc, app as TrainBudApp) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        // Wrapped: unwrapped, this rendered as "airing failed. Tap to retr" on a
        // round screen, losing both ends of the only instruction it gives.
        var titleLines = wrapText(WatchUi.loadResource(Rez.Strings.PairingError) as String, 18);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < titleLines.size(); i += 1) {
            dc.drawText(cx, cy - 40 + (i * 20), Graphics.FONT_SMALL,
                titleLines[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var code = app.getPairErrorCode();
        if (code != null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cy + 10, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.ErrorCodePrefix) as String) + " " + code.toString(),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            if (code == -104) {
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, cy + 34, Graphics.FONT_XTINY,
                    WatchUi.loadResource(Rez.Strings.NoPhoneHint) as String,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            } else if (code == -1001) {
                // SECURE_CONNECTION_REQUIRED. Show the URL actually in use: the
                // baked default and a value stored from an earlier pairing are
                // different sources, and only one of them is visible in the build.
                var serverUrl = app.getServerUrl();
                dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                var urlLines = wrapText(serverUrl == null ? "<no url>" : serverUrl as String, 26);
                var urlShown = urlLines.size() > 3 ? 3 : urlLines.size();
                for (var u = 0; u < urlShown; u += 1) {
                    dc.drawText(cx, cy + 32 + (u * 14), Graphics.FONT_XTINY,
                        urlLines[u] as String,
                        Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                }
            } else {
                // A 2xx with an unexpected body: show what actually arrived.
                var body = app.getPairErrorBody();
                if (body != null) {
                    dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
                    var lines = wrapText(body as String, 24);
                    var shown = lines.size() > 4 ? 4 : lines.size();
                    for (var i = 0; i < shown; i += 1) {
                        dc.drawText(cx, cy + 32 + (i * 15), Graphics.FONT_XTINY,
                            lines[i] as String,
                            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                    }
                }
            }
        }
    }

    // Wraps rather than drawing one long line. "Pairing failed. Tap to retry."
    // ran off both edges of a round screen and rendered as "airing failed. Tap
    // to retr", which loses the instruction the message exists to give.
    private function drawMessage(dc as Dc, message as String) as Void {
        var lines  = wrapText(message, 20);
        var lineH  = 22;
        var startY = (dc.getHeight() / 2) - (((lines.size() - 1) * lineH) / 2);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < lines.size(); i += 1) {
            dc.drawText(
                dc.getWidth() / 2, startY + (i * lineH),
                Graphics.FONT_SMALL, lines[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
            );
        }
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

    // Position indicator. Replaces the static "tap or swipe" hint, which told
    // you what you could do but never where you were in the carousel.
    private function drawPageDots(dc as Dc, cardIndex as Number, cardCount as Number) as Void {
        if (cardCount <= 1) { return; }

        var spacing = 10;
        var radius  = 2;
        var totalW  = (cardCount - 1) * spacing;
        var startX  = (dc.getWidth() / 2) - (totalW / 2);
        var y       = dc.getHeight() - 12;

        for (var i = 0; i < cardCount; i += 1) {
            var x = startX + (i * spacing);
            if (i == cardIndex) {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, radius + 1);
            } else {
                dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, radius);
            }
        }
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
        if (cardIndex == Cards.OVERVIEW)   { drawOverviewCard(dc, summary); return; }
        if (cardIndex == Cards.RECOVERY)   { drawRecoveryCard(dc, summary, roundScreen); return; }
        if (cardIndex == Cards.AI_INSIGHT) { drawAiInsightCard(dc, summary); return; }

        var title      = getCardTitle(cardIndex);
        var value      = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var subtitle   = "";
        var footnote   = "";
        var valueColor = Graphics.COLOR_WHITE;

        if (summary != null) {
            var cardData = getCardData(cardIndex, summary);
            value      = cardData[:value] as String;
            subtitle   = cardData[:subtitle] as String;
            footnote   = cardData[:footnote] as String;
            valueColor = cardData[:color] as Number;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 28, Graphics.FONT_SMALL, title, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2 - 8, Graphics.FONT_NUMBER_HOT,
            value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // The subtitle and the footnote were 26 pixels apart with a FONT_TINY
        // line between them, so on the Activity card "1h 23m . 0 km . 114 bpm"
        // and "VO2 46 stable" ran into each other. Stack them by their real
        // heights instead.
        var subtitleY = dc.getHeight() / 2 + 36;

        if ((subtitle as String).length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, subtitleY, Graphics.FONT_TINY,
                subtitle, Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Secondary metric folded onto this card (VO2 max on Activity).
        if ((footnote as String).length() > 0) {
            var footnoteY = (subtitle as String).length() > 0
                ? subtitleY + dc.getFontHeight(Graphics.FONT_TINY)
                : subtitleY;
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, footnoteY, Graphics.FONT_XTINY,
                footnote, Graphics.TEXT_JUSTIFY_CENTER);
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

        // "No data" is too wide for a quarter of the screen: four of them drew
        // over each other and over their own labels. The glance has always used
        // a dash for the same reason.
        var placeholder = WatchUi.loadResource(Rez.Strings.NoDataShort) as String;
        var recValue   = placeholder;
        var sleepValue = placeholder;
        var stressValue = placeholder;
        var vo2Value   = placeholder;

        if (summary != null) {
            var overview = summary.get("daily_overview");
            if (overview != null && overview instanceof Dictionary) {
                var ov = overview as Dictionary;
                var recovery = ov.get("recovery");
                if (recovery != null) { recValue = metricText(recovery); }
                var sleepH = ov.get("sleep_h");
                if (sleepH != null) { sleepValue = metricText(sleepH) + "h"; }
                var stress = ov.get("stress");
                if (stress != null) { stressValue = metricText(stress); }
                var vo2 = ov.get("vo2max");
                if (vo2 != null) { vo2Value = metricText(vo2); }
            }
        }

        var leftX   = dc.getWidth() / 4;
        var rightX  = (dc.getWidth() * 3) / 4;

        // The rows were 42 pixels apart with hard-coded offsets, while a cell is
        // a label plus a value in FONT_MEDIUM underneath it -- taller than that
        // on every device. The top row's numbers drew straight through the
        // bottom row's labels ("91" over "Stress", "6.3h" over "VO2"). Deriving
        // the pitch from the fonts keeps the rows clear at any screen size.
        var labelHeight = dc.getFontHeight(Graphics.FONT_XTINY);
        var valueHeight = dc.getFontHeight(Graphics.FONT_MEDIUM);
        var rowHeight   = labelHeight + valueHeight;
        var rowGap      = valueHeight / 4;
        var topY        = dc.getHeight() / 2 - rowHeight - rowGap / 2;
        var bottomY     = topY + rowHeight + rowGap;

        drawOverviewCell(dc, leftX,  topY,    WatchUi.loadResource(Rez.Strings.LabelRecovery) as String, recValue,    recoveryColor(parseNumber(recValue)));
        drawOverviewCell(dc, rightX, topY,    WatchUi.loadResource(Rez.Strings.LabelSleep) as String,    sleepValue,  Graphics.COLOR_WHITE);
        drawOverviewCell(dc, leftX,  bottomY, WatchUi.loadResource(Rez.Strings.LabelStress) as String,   stressValue, stressColor(parseNumber(stressValue)));
        drawOverviewCell(dc, rightX, bottomY, WatchUi.loadResource(Rez.Strings.LabelVo2) as String,      vo2Value,    Graphics.COLOR_WHITE);
    }

    // JSON numbers arrive as Float whenever the server sent a decimal, and
    // Float.toString() renders six decimal places: sleep of 6.3 hours drew as
    // "6.300000h" on the watch, which then overflowed its cell. Every metric
    // that can be fractional goes through this.
    private function metricText(value) as String {
        if (value instanceof Float || value instanceof Double) {
            return (value as Float).format("%.1f");
        }
        return value.toString();
    }

    private function drawOverviewCell(dc as Dc, x as Number, y as Number, label as String, value as String, valueColor as Number) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        // The value sits directly below its own label, so the offset is the
        // label's real height rather than a constant that only suited one
        // screen.
        dc.drawText(x, y + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_MEDIUM, value,
            Graphics.TEXT_JUSTIFY_CENTER);
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
            // The ring was a fixed inset from the screen edge, which put its top
            // at y=36 -- inside the title, which occupies y=24 to roughly y=52.
            // The score arc drew straight through the word "Recovery". Size it
            // to whatever clears the title instead, so it stays clear on any
            // screen and with any system font.
            var titleBottom = 24 + dc.getFontHeight(Graphics.FONT_SMALL);
            var maxRadius   = (dc.getWidth() / 2) - 12;
            var clearance   = cy - titleBottom - 6;
            var radius      = clearance < maxRadius ? clearance : maxRadius;
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, radius, Graphics.ARC_CLOCKWISE, 90, 90 - 360);

            // The end angle is measured clockwise from the top -- 90 minus the
            // score's share of the circle -- but the arc was drawn with
            // ARC_COUNTER_CLOCKWISE, so it swept the other way and rendered the
            // complement: a score of 91 drew as a 33-degree sliver, which is
            // the missing 9%. The higher the score, the emptier the ring looked.
            var endAngle = 90 - ((score * 360) / 100);
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(cx, cy, radius, Graphics.ARC_CLOCKWISE, 90, endAngle);
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

        drawRestingHeartRate(dc, summary, cx, cy + 62);
    }

    // Resting and max heart rate share the Recovery card: resting HR is how the
    // recovery score is largely derived, so the two are read together.
    private function drawRestingHeartRate(
        dc as Dc,
        summary as Dictionary or Null,
        cx as Number,
        y as Number
    ) as Void {
        if (summary == null) { return; }

        var heartRate = summary.get("heart_rate");
        if (heartRate == null || !(heartRate instanceof Dictionary)) { return; }

        var hd      = heartRate as Dictionary;
        var resting = hd.get("resting");
        var max     = hd.get("max");
        if (resting == null) { return; }

        var text = WatchUi.loadResource(Rez.Strings.LabelResting) as String + " " + resting.toString();
        if (max != null) {
            text = text + "  " + WatchUi.loadResource(Rez.Strings.LabelMax) as String + " " + max.toString();
        }

        dc.setColor(heartRateColor(resting as Number), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_XTINY, text, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // -------------------------------------------------------------------------
    // Card titles & data
    // -------------------------------------------------------------------------

    private function getCardTitle(cardIndex as Number) as String {
        if (cardIndex == Cards.SLEEP)    { return WatchUi.loadResource(Rez.Strings.CardSleep) as String; }
        if (cardIndex == Cards.ACTIVITY) { return WatchUi.loadResource(Rez.Strings.CardActivity) as String; }
        return WatchUi.loadResource(Rez.Strings.CardStress) as String;
    }

    private function getCardData(cardIndex as Number, summary as Dictionary) as Dictionary {
        var result = {
            :value    => WatchUi.loadResource(Rez.Strings.NoData) as String,
            :subtitle => "",
            :footnote => "",
            :color    => Graphics.COLOR_WHITE
        };

        if (cardIndex == Cards.SLEEP) {
            var sleep = summary.get("sleep");
            if (sleep != null && sleep instanceof Dictionary) {
                var sd = sleep as Dictionary;
                var hours = sd.get("hours");
                var score = sd.get("score");
                var lbl   = sd.get("label");
                if (hours != null) { result[:value] = metricText(hours) + "h"; }
                if (score != null) {
                    result[:subtitle] = "Score " + score.toString();
                    result[:color]    = sleepColor(score as Number);
                } else if (lbl != null) {
                    result[:subtitle] = lbl as String;
                }
            }
            return result;
        }

        if (cardIndex == Cards.ACTIVITY) {
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
                // Connect reports 0 km for workouts that do not cover ground, so
                // a strength session read "1h 23m . 0 km . 114 bpm". A distance
                // of zero is an absence, not a measurement.
                if (distance != null && (distance as Float) > 0) { parts.add(metricText(distance) + " km"); }
                if (avgHr != null)    { parts.add(avgHr.toString() + " bpm"); }
                result[:subtitle] = joinParts(parts, " · ");
            }

            // VO2 max shares this card — it is a single number with a trend and
            // did not justify a swipe of its own.
            var vo2max = summary.get("vo2max");
            if (vo2max != null && vo2max instanceof Dictionary) {
                var vd    = vo2max as Dictionary;
                var vo2   = vd.get("value");
                var trend = vd.get("trend");
                if (vo2 != null) {
                    var vo2Text = WatchUi.loadResource(Rez.Strings.LabelVo2) as String + " " + metricText(vo2);
                    if (trend != null) { vo2Text = vo2Text + " " + (trend as String); }
                    result[:footnote] = vo2Text;
                }
            }
            return result;
        }

        var stress = summary.get("stress");
        if (stress != null && stress instanceof Dictionary) {
            var sd = stress as Dictionary;
            var avg = sd.get("avg");
            var lbl = sd.get("label");
            if (avg != null) { result[:value] = metricText(avg); result[:color] = stressColor(avg as Number); }
            if (lbl != null) { result[:subtitle] = lbl as String; }
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
