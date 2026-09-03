import Toybox.Application;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

class TrainBudView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var app = Application.getApp() as TrainBudApp;

        // In a -Screens build there is no server to fetch from, and fetching
        // would immediately overwrite whatever state the tour had set.
        if (ScreenTour.isActive()) {
            ScreenTour.enter(app);
            return;
        }

        app.fetchSummary();
    }

    function onUpdate(dc as Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        drawScreen(dc);
        drawTourLabel(dc);
    }

    private function drawScreen(dc as Dc) as Void {
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
            drawSetupScreen(dc);
            return;
        }

        if (status.equals("loading")) {
            drawMessage(dc, WatchUi.loadResource(Rez.Strings.Loading) as String);
            return;
        }

        // "Could not reach TrainBud" was drawn for every summary failure,
        // including a 401 from a server that had been reached and had answered.
        // The classified screen names the cause and the action.
        if (status.equals("error")) {
            drawRequestFailure(dc, app, app.getSummaryFailClass(),
                app.getSummaryErrorCode(), false);
            return;
        }

        var cardIndex = app.getCardIndex();
        var cardId = app.currentCardId();

        // Ask AI menu
        if (cardId.equals(Cards.ASK_AI)) {
            // Nothing on this card can work without a key on the server, so
            // say that instead of offering five questions that will all fail.
            if (!app.isAiConfigured()) {
                drawAiSetupNeeded(dc);
                return;
            }

            // Checked before the menu, so the user is not offered five
            // questions that will all be refused.
            if (app.isBudgetExceeded()) {
                drawBudgetReached(dc);
                return;
            }

            var promptStatus = app.getPromptStatus();
            if (promptStatus.equals("idle")) {
                drawAskAiMenu(dc, app);
            } else if (promptStatus.equals("submitting") || promptStatus.equals("waiting")) {
                drawMessage(dc, WatchUi.loadResource(Rez.Strings.AiThinking) as String);
            } else if (promptStatus.equals("done")) {
                drawPromptResult(dc, app);
            } else {
                drawPromptError(dc, app);
            }
            return;
        }

        drawCard(dc, cardId, app.getSummary(), isRoundScreen(dc));

        if (status.equals("stale")) {
            drawStaleIndicator(dc, app.getCachedAt());
        }

        drawPageDots(dc, cardIndex, app.getCardCount());
    }

    //
    // Numbers the tour state on screen, in a -Screens build only.
    //
    // This is the ground truth a capture run is checked against, and it earned
    // its place on the first run: a keypress was swallowed while the app was
    // still starting, so every screenshot after it was saved under the name of
    // the state before it. Every file was of a real screen and every file was
    // mislabelled, which is worse than a failed run -- a mislabelled set of
    // screenshots is evidence that says the wrong thing.
    //
    // The index only, not the state name: the name is already in the filename,
    // and a long string here covers the card headings underneath it.
    //
    private function drawTourLabel(dc as Dc) as Void {
        if (!ScreenTour.isActive()) { return; }
        var text = (ScreenTour.index() + 1).toString() + "/"
            + ScreenTour.count().toString();
        // Blue, not grey: the Forerunner 55's eight-colour palette has no grey
        // at all and snaps COLOR_DK_GRAY to black on a black background, which
        // is how four separate UI elements became invisible there.
        dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 2, Graphics.FONT_XTINY, text,
            Graphics.TEXT_JUSTIFY_CENTER);
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
        //
        // Debug builds only. To a user this read as "9/8 200" in the corner of
        // the pairing screen, which is unexplainable noise; to whoever is
        // debugging it is the difference between a poll that never ran and one
        // that ran and was discarded on the device.
        if (app.isDebugBuild()) {
            var attempts = app.getPairPollAttempts();
            var polls = app.getPairPollCount();
            var pollCode = app.getPairPollCode();
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, dc.getHeight() - 8, Graphics.FONT_XTINY,
                attempts.toString() + "/" + polls.toString()
                    + (pollCode == null ? "" : " " + pollCode.toString()),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Ask AI menu
    // -------------------------------------------------------------------------

    private function drawAskAiMenu(dc as Dc, app as TrainBudApp) as Void {
        var cx = dc.getWidth() / 2;
        var h  = dc.getHeight();
        var lineH = dc.getFontHeight(Graphics.FONT_XTINY);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardAskAi) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        // The action hint sits under the title, centred.
        //
        // It used to be right-justified against the screen edge at the vertical
        // centre, which is exactly where the selected prompt is drawn: on the
        // 208 px Forerunner 55 they printed on top of each other and the card
        // read "Why is my re[STA]sting HR up?". A round screen has no usable
        // margin at its widest point, so nothing belongs out there.
        dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20 + dc.getFontHeight(Graphics.FONT_SMALL), Graphics.FONT_XTINY,
            WatchUi.loadResource(
                isTouch() ? Rez.Strings.SelectTouch : Rez.Strings.SelectButton) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var idx    = app.getAskMenuIndex();
        var count  = app.getPromptCount();

        // Draw prev/next prompts faded, current highlighted
        var prompts = new [count] as Array<String>;
        for (var i = 0; i < count; i += 1) {
            prompts[i] = app.getPromptText(i);
        }

        var midY = h / 2;

        // Current item
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, midY, Graphics.FONT_TINY,
            fitLine(dc, prompts[idx], Graphics.FONT_TINY,
                midY - (dc.getFontHeight(Graphics.FONT_TINY) / 2)),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Prev item (faded)
        if (idx > 0) {
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, midY - lineH - 10, Graphics.FONT_XTINY,
                fitLine(dc, prompts[idx - 1], Graphics.FONT_XTINY,
                    midY - lineH - 10 - (lineH / 2)),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Next item (faded)
        if (idx < count - 1) {
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, midY + lineH + 10, Graphics.FONT_XTINY,
                fitLine(dc, prompts[idx + 1], Graphics.FONT_XTINY,
                    midY + lineH + 10 - (lineH / 2)),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        // Selection dots
        var dotY = h - 16;
        var dotSpacing = 12;
        var startX = cx - ((count - 1) * dotSpacing) / 2;
        // Filled for the current item, outlined for the rest. This was a filled
        // white circle against filled COLOR_DK_GRAY ones, and DK_GRAY is not in
        // the Forerunner 55's palette: it snapped to black on a black background
        // and only the selected dot was ever visible there. Shape survives any
        // palette; colour does not.
        for (var i = 0; i < count; i += 1) {
            if (i == idx) {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(startX + i * dotSpacing, dotY, 4);
            } else {
                dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
                dc.drawCircle(startX + i * dotSpacing, dotY, 3);
            }
        }

    }

    /** Reads the payload flag directly, for the card drawers that are handed a
        summary rather than the app. Missing means an older server: treated as
        configured, so nothing is claimed on no evidence. */
    private function isAiConfiguredIn(summary as Dictionary) as Boolean {
        var flag = summary.get("ai_configured");
        if (flag == null || !(flag instanceof Boolean)) { return true; }
        return flag as Boolean;
    }

    // AI has no key on the server.
    //
    // Distinct from a failed call, and from a day with no insight yet. Those
    // three all rendered as "AI unavailable", which names no action; this one
    // has an action and it is the only one the user can take.
    private function drawAiSetupNeeded(dc as Dc) as Void {
        drawNotice(dc,
            WatchUi.loadResource(Rez.Strings.AiNotSetUp) as String,
            WatchUi.loadResource(Rez.Strings.AiSetUpHint) as String);
    }

    //
    // The user's own monthly cap has been reached.
    //
    // Said here rather than after a round trip. The server refuses the request
    // and returns the reason, but a watch that submits anyway spends a fetch, a
    // spinner and about thirty seconds of polling to be told something it was
    // already holding in the payload -- and on a screen where every question
    // costs the user real money, "why did nothing happen" is the worst possible
    // answer. Only ever reached when the user set a cap themselves; there is no
    // default ceiling.
    //
    private function drawBudgetReached(dc as Dc) as Void {
        drawNotice(dc,
            WatchUi.loadResource(Rez.Strings.AiBudgetReached) as String,
            WatchUi.loadResource(Rez.Strings.AiBudgetHint) as String);
    }

    /** A headline in amber over a wrapped explanation, centred as one block. */
    private function drawNotice(dc as Dc, headline as String, hint as String) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var titleH = dc.getFontHeight(Graphics.FONT_SMALL);
        var lineH  = dc.getFontHeight(Graphics.FONT_XTINY);

        var lines = wrapToWidth(dc, hint, Graphics.FONT_XTINY, lineH);
        var y = cy - ((titleH + (lines.size() * lineH)) / 2);

        // Amber: this is a state of the app the user has to act on, which is
        // exactly what the caution colour is reserved for.
        dc.setColor(Palette.CAUTION, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_SMALL,
            fitLine(dc, headline, Graphics.FONT_SMALL, y),
            Graphics.TEXT_JUSTIFY_CENTER);
        y += titleH;

        dc.setColor(Palette.PRIMARY, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < lines.size(); i += 1) {
            dc.drawText(cx, y, Graphics.FONT_XTINY, lines[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }
    }

    // A failed answer, with the reason the server gave.
    //
    // "AI unavailable" was the whole screen. The server records why each job
    // failed and returns it on /api/prompt/<id>; the watch read the status and
    // dropped the reason, so a missing API key and a provider outage looked
    // identical from the wrist.
    private function drawPromptError(dc as Dc, app as TrainBudApp) as Void {
        // The reported bug, on screen. A request that never reached the server
        // is not an AI failure, and drawing "AI unavailable / HTTP -400" over a
        // dead tunnel sent the user looking at the one component that was
        // working. Transport failures get the same screen every other request
        // path gets; only a job the server actually ran and failed reaches the
        // "AI unavailable" wording below.
        if (app.getPromptFailClass() != Fail.NONE) {
            drawRequestFailure(dc, app, app.getPromptFailClass(),
                app.getPromptErrorCode(), false);
            return;
        }

        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var titleH = dc.getFontHeight(Graphics.FONT_SMALL);
        var lineH  = dc.getFontHeight(Graphics.FONT_XTINY);

        var reason = app.getPromptError();
        var lines = reason == null
            ? ([] as Array<String>)
            : wrapToWidth(dc, reason as String, Graphics.FONT_XTINY, lineH * 2);
        var shown = lines.size() > 3 ? 3 : lines.size();

        var y = cy - ((titleH + (shown * lineH)) / 2);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_SMALL,
            fitLine(dc, WatchUi.loadResource(Rez.Strings.AiError) as String,
                Graphics.FONT_SMALL, y),
            Graphics.TEXT_JUSTIFY_CENTER);
        y += titleH;

        dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < shown; i += 1) {
            dc.drawText(cx, y, Graphics.FONT_XTINY, lines[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }
    }

    // -------------------------------------------------------------------------
    // Prompt result
    // -------------------------------------------------------------------------

    //
    // The AI answer, wrapped and paged by line.
    //
    // What was here cut the answer into eighty-character substrings and handed
    // one to a single drawText. Monkey C does not wrap text: the whole page was
    // laid out on one line, ran off both edges of a round screen, and the cut
    // landed mid-word. Every answer this app has ever produced was unreadable.
    // It survived because AI was never configured on the machine this was
    // written on, so this function had never once run with real text in it --
    // the same reason the six layout bugs of 1.3.0 shipped.
    //
    // Now: wrap to the chord width, fill the band between the "AI:" heading and
    // the footer, and report the resulting page count back to the app so the
    // delegate stops paging at the end of the answer rather than at the end of
    // an arithmetic guess.
    //
    private function drawPromptResult(dc as Dc, app as TrainBudApp) as Void {
        var cx   = dc.getWidth() / 2;
        var cy   = dc.getHeight() / 2;
        var lineH = dc.getFontHeight(Graphics.FONT_XTINY);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 16, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.ResultPrefix) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        // The band the answer may use: below the heading, above the footer that
        // carries the page counter and, on the last page, the disclaimer.
        var bandTop = 16 + lineH + (lineH / 2);
        var bandBot = dc.getHeight() - 12 - (lineH * 3);
        var bandH   = bandBot - bandTop;
        if (bandH < lineH) { bandH = lineH; }

        var linesPerPage = (bandH / lineH).toNumber();
        if (linesPerPage < 1) { linesPerPage = 1; }

        // Measured at the widest point the text will occupy, not at the centre:
        // on a round screen the top and bottom lines of a full band are
        // materially narrower than the middle, and wrapping to the middle width
        // truncates them.
        var text  = app.getPromptResult();
        var body  = text == null ? "" : text as String;
        var halfBand = (linesPerPage * lineH) / 2;
        var lines = wrapToWidth(dc, body, Graphics.FONT_XTINY, halfBand);

        var pages = ((lines.size() + linesPerPage - 1) / linesPerPage).toNumber();
        if (pages < 1) { pages = 1; }
        app.setPromptPageCount(pages);

        var page  = app.getPromptPageIndex();
        var first = page * linesPerPage;
        var shown = lines.size() - first;
        if (shown > linesPerPage) { shown = linesPerPage; }

        var y = cy - ((shown * lineH) / 2);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < shown; i += 1) {
            dc.drawText(cx, y, Graphics.FONT_XTINY, lines[first + i] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }

        // On the last page, say what this text is. The disclaimer string has
        // existed since 1.2.0 and was never drawn: the app has been making
        // training and recovery statements on a health device with nothing on
        // screen to qualify them. The listing carried a disclaimer; the watch,
        // where the sentence is actually read, did not.
        if (page == pages - 1) {
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            var noteH = dc.getFontHeight(Graphics.FONT_XTINY);
            var noteY = dc.getHeight() - 12 - (noteH * 2);
            var note  = wrapToWidth(dc, WatchUi.loadResource(Rez.Strings.AiDisclaimer) as String,
                Graphics.FONT_XTINY, noteY - (dc.getHeight() / 2));
            for (var n = 0; n < note.size() && n < 2; n += 1) {
                dc.drawText(cx, noteY + (n * noteH), Graphics.FONT_XTINY,
                    note[n] as String,
                    Graphics.TEXT_JUSTIFY_CENTER);
            }
        }

        if (pages > 1) {
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, dc.getHeight() - 8, Graphics.FONT_XTINY,
                (page + 1).toString() + "/" + pages.toString(),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Shared helpers
    // -------------------------------------------------------------------------

    // Ask the device, do not measure it.
    //
    // This was `dc.getWidth() == dc.getHeight() && dc.getWidth() >= 240`, a
    // guess that gets the Forerunner 55 wrong: it is round and 208x208, so the
    // >= 240 arm classified it as rectangular and it drew the recovery bar on a
    // round screen instead of the ring. Every device in the manifest reports its
    // own shape and there is no reason to infer it from pixels.
    private function isRoundScreen(dc as Dc) as Boolean {
        var shape = System.getDeviceSettings().screenShape;
        return shape == System.SCREEN_SHAPE_ROUND;
    }

    /** True on the five button-only products in the manifest: fr55, fr745 and
        the three Instinct 3 variants. Every action hint in this app used to say
        "tap", which none of them can do. */
    private function isTouch() as Boolean {
        var touch = System.getDeviceSettings().isTouchScreen;
        return touch != null && touch;
    }

    private function retryHint() as String {
        return WatchUi.loadResource(
            isTouch() ? Rez.Strings.RetryTouch : Rez.Strings.RetryButton) as String;
    }

    // Secondary text and the track behind a value.
    //
    // COLOR_DK_GRAY (0x555555) is not in the Forerunner 55's eight-colour
    // palette and snaps to black, on a black background, so inactive page dots,
    // faded menu items, card footnotes and the ring track were all invisible on
    // that device. COLOR_LT_GRAY snaps to white instead, which is readable
    // everywhere; hierarchy is carried by font size and by filled-versus-outline
    // dots, neither of which depends on the palette.
    private function dimColor() as Number {
        return Graphics.COLOR_LT_GRAY;
    }

    // First run with no server configured.
    //
    // Reached only since 1.3.1: the build used to ship a default ServerUrl
    // pointing at one developer's personal tunnel, so a fresh install skipped
    // this state entirely and went straight to a pairing attempt against a host
    // that was usually gone. This is the screen that should have been there.
    private function drawSetupScreen(dc as Dc) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var titleH = dc.getFontHeight(Graphics.FONT_SMALL);
        var lineH  = dc.getFontHeight(Graphics.FONT_XTINY);

        var title = WatchUi.loadResource(Rez.Strings.SetupTitle) as String;
        var body  = wrapToWidth(dc, WatchUi.loadResource(Rez.Strings.SetupBody) as String,
            Graphics.FONT_XTINY, 0);
        var urlLines = wrapToWidth(dc, WatchUi.loadResource(Rez.Strings.SetupUrl) as String,
            Graphics.FONT_XTINY, lineH * 3);

        var height = titleH + (body.size() * lineH) + lineH + (urlLines.size() * lineH);
        var y = cy - (height / 2);

        dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_SMALL, title, Graphics.TEXT_JUSTIFY_CENTER);
        y += titleH;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < body.size(); i += 1) {
            dc.drawText(cx, y, Graphics.FONT_XTINY, body[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }

        y += lineH;
        dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
        for (var u = 0; u < urlLines.size(); u += 1) {
            dc.drawText(cx, y, Graphics.FONT_XTINY, urlLines[u] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }
    }

    // One screen per cause, not one screen for all of them.
    //
    // This used to say "Pairing failed. Tap to retry." whatever had happened,
    // which is the screen the Forerunner 55 report was made from. The failure
    // there was a dead tunnel answering an HTML error page, and the one thing
    // the user could act on -- the Server URL -- was never mentioned. The raw
    // Connect IQ code stays on screen underneath: negative codes are Connect IQ
    // constants rather than HTTP statuses, and having the number visible is what
    // identified -200 and -400 during the 2026-08 investigation.
    //
    // Laid out with a running cursor rather than fixed offsets. The blocks are
    // one or two lines depending on the message and the screen, and a fixed
    // layout either overlapped them or left a gap; on the 208 px Forerunner 55
    // the https hint and the URL landed on top of each other.
    private function drawPairingError(dc as Dc, app as TrainBudApp) as Void {
        drawRequestFailure(dc, app, app.getPairFailClass(), app.getPairErrorCode(), true);
    }

    //
    // One failure screen for every request path.
    //
    // Pairing had this and the other two paths did not, so the summary fetch
    // drew "Could not reach TrainBud" for a 401 it had reached perfectly well,
    // and the Ask card drew "AI unavailable" for a tunnel that was down. Both
    // now arrive here and get the cause they actually had.
    //
    private function drawRequestFailure(
        dc as Dc,
        app as TrainBudApp,
        failClass as Number,
        code as Number or Null,
        showDebugBody as Boolean
    ) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;
        var titleH = dc.getFontHeight(Graphics.FONT_SMALL);
        var lineH  = dc.getFontHeight(Graphics.FONT_XTINY);

        var titleRes = Rez.Strings.PairErrUnreachable;
        if (failClass == Fail.NOT_SERVER) {
            titleRes = Rez.Strings.PairErrNotServer;
        } else if (failClass == Fail.REFUSED) {
            titleRes = Rez.Strings.PairErrRefused;
        } else if (failClass == Fail.UNAUTHORIZED) {
            titleRes = Rez.Strings.ErrUnauthorized;
        } else if (failClass == Fail.EXPIRED) {
            titleRes = Rez.Strings.PairErrExpired;
        }

        var hint    = failureHint(app, failClass, code);
        var showUrl = failClass == Fail.NOT_SERVER
            || code == Communications.SECURE_CONNECTION_REQUIRED;
        var url     = showUrl ? displayUrl(app.getServerUrl()) : null;

        // Measure first, then place, so the block ends up centred whatever it
        // turned out to contain.
        var title     = WatchUi.loadResource(titleRes) as String;
        var titleWrap = wrapToWidth(dc, title, Graphics.FONT_SMALL, -titleH);
        var height    = titleWrap.size() * titleH + lineH;   // title + retry line
        var hintWrap  = null;
        var urlWrap   = null;
        if (hint != null) {
            hintWrap = wrapToWidth(dc, hint as String, Graphics.FONT_XTINY, 0);
            height += hintWrap.size() * lineH;
        }
        if (url != null) {
            urlWrap = wrapToWidth(dc, url as String, Graphics.FONT_XTINY, lineH * 2);
            height += urlWrap.size() * lineH;
        }
        if (code != null) { height += lineH; }

        var y = cy - (height / 2);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        for (var i = 0; i < titleWrap.size(); i += 1) {
            dc.drawText(cx, y, Graphics.FONT_SMALL, titleWrap[i] as String,
                Graphics.TEXT_JUSTIFY_CENTER);
            y += titleH;
        }

        // The one sentence that says what to do about it.
        if (hintWrap != null) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            for (var h = 0; h < hintWrap.size(); h += 1) {
                dc.drawText(cx, y, Graphics.FONT_XTINY, hintWrap[h] as String,
                    Graphics.TEXT_JUSTIFY_CENTER);
                y += lineH;
            }
        }

        // The address actually in use, whenever the address is the suspect. It
        // can come from the app setting or from a value stored by an earlier
        // pairing, and only one of those is visible anywhere else.
        dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
        if (urlWrap != null) {
            for (var u = 0; u < urlWrap.size(); u += 1) {
                dc.drawText(cx, y, Graphics.FONT_XTINY, urlWrap[u] as String,
                    Graphics.TEXT_JUSTIFY_CENTER);
                y += lineH;
            }
        }

        // Code and retry hint on separate lines. Together they were 32
        // characters and lost one off each end of a round 208 px screen.
        if (code != null) {
            dc.drawText(cx, y, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.ErrorCodePrefix) as String)
                    + " " + code.toString(),
                Graphics.TEXT_JUSTIFY_CENTER);
            y += lineH;
        }
        dc.drawText(cx, y, Graphics.FONT_XTINY, retryHint(),
            Graphics.TEXT_JUSTIFY_CENTER);

        // What actually came back, debug builds only. It is the fastest way to
        // recognise an interstitial or a captive portal, and it is noise to a
        // user who has already been told to check the URL.
        if (showDebugBody && app.isDebugBuild()) {
            var body = app.getPairErrorBody();
            if (body != null) {
                y += lineH;
                var lines = wrapToWidth(dc, body as String, Graphics.FONT_XTINY, lineH * 3);
                for (var b = 0; b < lines.size() && b < 2; b += 1) {
                    dc.drawText(cx, y, Graphics.FONT_XTINY, lines[b] as String,
                        Graphics.TEXT_JUSTIFY_CENTER);
                    y += lineH;
                }
            }
        }
    }

    // The server URL as it should be read on a wrist.
    //
    // "https://" is eight characters of a fifty-character line on a screen that
    // fits about twenty-four, and it is the same on every working URL, so it is
    // dropped. "http://" is kept deliberately: on a SECURE_CONNECTION_REQUIRED
    // failure the missing "s" is the entire diagnosis, and hiding the scheme
    // would hide the answer.
    private function displayUrl(url as String or Null) as String {
        if (url == null) { return "<no url>"; }
        var u = url as String;
        if (u.length() > 8 && u.substring(0, 8).equals("https://")) {
            return u.substring(8, u.length());
        }
        return u;
    }

    /** The actionable sentence for a failure, or null when the class name
        already says everything that can be said. */
    private function failureHint(
        app as TrainBudApp,
        failClass as Number,
        code as Number or Null
    ) as String or Null {
        if (code != null) {
            if (code == Communications.BLE_CONNECTION_UNAVAILABLE) {
                return WatchUi.loadResource(Rez.Strings.HintNoPhone) as String;
            }
            // SECURE_CONNECTION_REQUIRED is two different problems wearing one
            // number. Connect IQ returns it for a plain http:// URL, and also
            // for an https:// URL whose certificate it will not accept, which
            // is what a self-hosted user with a self-signed certificate gets.
            // Telling that user to "use an https:// URL" when they already are
            // is the same dead end the old single "Pairing failed" message was.
            if (code == Communications.SECURE_CONNECTION_REQUIRED) {
                var configured = app.getServerUrl();
                var isHttps = configured != null
                    && (configured as String).length() > 8
                    && (configured as String).substring(0, 8).equals("https://");
                return WatchUi.loadResource(
                    isHttps ? Rez.Strings.HintBadCert : Rez.Strings.HintHttps) as String;
            }
            if (code == 429) {
                return WatchUi.loadResource(Rez.Strings.HintTooMany) as String;
            }
        }
        if (failClass == Fail.NOT_SERVER) {
            return WatchUi.loadResource(Rez.Strings.HintCheckUrl) as String;
        }
        if (failClass == Fail.UNAUTHORIZED) {
            return WatchUi.loadResource(Rez.Strings.HintRepair) as String;
        }
        if (failClass == Fail.EXPIRED) {
            return WatchUi.loadResource(Rez.Strings.HintNewCode) as String;
        }
        return null;
    }

    // Wraps rather than drawing one long line. "Pairing failed. Tap to retry."
    // ran off both edges of a round screen and rendered as "airing failed. Tap
    // to retr", which loses the instruction the message exists to give.
    private function drawMessage(dc as Dc, message as String) as Void {
        var lines  = wrapToWidth(dc, message, Graphics.FONT_SMALL, 0);
        var lineH  = dc.getFontHeight(Graphics.FONT_SMALL);
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
            // Filled-versus-outline carries the position, not colour. The
            // brand accent would be the same amber as CAUTION, and a user who
            // has learned amber means "look at this" must not meet it as a
            // page dot.
            if (i == cardIndex) {
                dc.setColor(Palette.PRIMARY, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(x, y, radius + 1);
            } else {
                dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
                dc.drawCircle(x, y, radius);
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

        // Amber: stale data is a caution about the data itself.
        dc.setColor(Palette.CAUTION, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 12, Graphics.FONT_XTINY, staleText, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // -------------------------------------------------------------------------
    // Card routing
    // -------------------------------------------------------------------------

    private function drawCard(
        dc as Dc,
        cardId as String,
        summary as Dictionary or Null,
        roundScreen as Boolean
    ) as Void {
        if (cardId.equals(Cards.TODAY))      { drawTodayCard(dc, summary); return; }
        if (cardId.equals(Cards.WEEK))       { drawWeekCard(dc, summary); return; }
        if (cardId.equals(Cards.OVERVIEW))   { drawOverviewCard(dc, summary); return; }
        if (cardId.equals(Cards.RECOVERY))   { drawRecoveryCard(dc, summary, roundScreen); return; }
        if (cardId.equals(Cards.AI_INSIGHT)) { drawAiInsightCard(dc, summary); return; }

        var title      = getCardTitle(cardId);
        var value      = WatchUi.loadResource(Rez.Strings.NoData) as String;
        var subtitle   = "";
        var footnote   = "";
        var valueColor = Palette.PRIMARY;

        if (summary != null) {
            var cardData = getCardData(dc, cardId, summary);
            value      = cardData[:value] as String;
            subtitle   = cardData[:subtitle] as String;
            footnote   = cardData[:footnote] as String;
            valueColor = cardData[:color] as Number;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, 28, Graphics.FONT_SMALL, title, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(valueColor, Graphics.COLOR_TRANSPARENT);
        drawFittedValue(dc, dc.getWidth() / 2, dc.getHeight() / 2 - 8, value);

        // The subtitle and the footnote were 26 pixels apart with a FONT_TINY
        // line between them, so on the Activity card "1h 23m . 0 km . 114 bpm"
        // and "VO2 46 stable" ran into each other. Stack them by their real
        // heights instead.
        var subtitleY = dc.getHeight() / 2 + 36;

        if ((subtitle as String).length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, subtitleY, Graphics.FONT_TINY,
                fitLine(dc, subtitle, Graphics.FONT_TINY, subtitleY),
                Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Secondary metric folded onto this card (VO2 max on Activity).
        if ((footnote as String).length() > 0) {
            var footnoteY = (subtitle as String).length() > 0
                ? subtitleY + dc.getFontHeight(Graphics.FONT_TINY)
                : subtitleY;
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(dc.getWidth() / 2, footnoteY, Graphics.FONT_XTINY,
                fitLine(dc, footnote, Graphics.FONT_XTINY, footnoteY),
                Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // -------------------------------------------------------------------------
    // Today card
    //
    // The one screen Connect cannot draw. Every other card in this app is a
    // number Garmin already shows on the same wrist; this one says what stands
    // out about those numbers, measured against this user's own baseline.
    //
    // Three states, and the difference between the last two is the point:
    // "nothing stands out" is a conclusion, "still gathering" is an admission.
    // Rendering an empty findings list as the first would tell a user with a
    // four-day-old watch that everything is fine, which the app cannot know.
    // -------------------------------------------------------------------------

    private function drawTodayCard(dc as Dc, summary as Dictionary or Null) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 24, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardToday) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        if (summary == null) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.NoData) as String, "");
            return;
        }

        // A summary cached before this field existed has no coverage at all.
        // Treated as not-ready, which is the honest reading: we do not know.
        var coverage = summary.get("coverage");
        var ready = false;
        var days = 0;
        if (coverage != null && coverage instanceof Dictionary) {
            var cd = coverage as Dictionary;
            var readyValue = cd.get("ready");
            var daysValue  = cd.get("days");
            ready = (readyValue != null && readyValue instanceof Boolean) ? readyValue as Boolean : false;
            days  = (daysValue != null && daysValue instanceof Number) ? daysValue as Number : 0;
        }

        if (!ready) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.TodayGathering) as String,
                days.toString() + " " + (WatchUi.loadResource(Rez.Strings.TodayGatheringDays) as String));
            return;
        }

        var findings = summary.get("findings");
        var list = (findings != null && findings instanceof Array) ? findings as Array : ([] as Array);

        if (list.size() == 0) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.TodayNothing) as String,
                WatchUi.loadResource(Rez.Strings.TodayNothingHint) as String);
            return;
        }

        drawFindings(dc, cx, cy, list);
    }

    private function drawTodayMessage(
        dc as Dc,
        cx as Number,
        cy as Number,
        title as String,
        hint as String
    ) as Void {
        var titleH = dc.getFontHeight(Graphics.FONT_SMALL);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 8, Graphics.FONT_SMALL,
            fitLine(dc, title, Graphics.FONT_SMALL, cy - 8 - (titleH / 2)),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        if (hint.length() > 0) {
            // Stacked off the title's real height rather than a fixed 26 px.
            var hintY = cy - 8 + (titleH / 2) + (dc.getFontHeight(Graphics.FONT_XTINY) / 2);
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, hintY, Graphics.FONT_XTINY,
                fitLine(dc, hint, Graphics.FONT_XTINY,
                    hintY - (dc.getFontHeight(Graphics.FONT_XTINY) / 2)),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    //
    // One line of a card: the text, and a dot to its left if it has a state.
    //
    // Shared by Today and Week because they were drifting apart -- Today drew
    // severity as a marker and Week still painted whole lines in red and
    // amber, so the same severity looked like two different things one swipe
    // apart. It is also the rule this app's colour system rests on: the state
    // channel is a mark, never the text, because coloured body text on a
    // transflective screen in daylight is the least legible thing here and
    // because a red sentence cannot also tell you it is only mildly red.
    //
    // `marker` is a colour, or -1 for a line with no state to report.
    //
    private function drawMarkedLine(
        dc as Dc,
        cx as Number,
        y as Number,
        text as String,
        font as Graphics.FontDefinition,
        textColor as Number,
        marker as Number
    ) as Void {
        if (text.length() == 0) { return; }

        var fitted = fitLine(dc, text, font, y);
        dc.setColor(textColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, font, fitted, Graphics.TEXT_JUSTIFY_CENTER);

        if (marker < 0) { return; }

        var dotRadius = 3;
        var half = dc.getTextWidthInPixels(fitted, font) / 2;
        dc.setColor(marker, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx - half - 6 - dotRadius,
            y + (dc.getFontHeight(font) / 2) - Graphics.getFontDescent(font) / 2,
            dotRadius);
    }

    //
    // What stands out, as text you can read plus a dot that says how much.
    //
    // Two changes from the version that shipped, and the second one is a
    // correctness bug rather than a matter of taste.
    //
    // THE SEVERITY IS A DOT, NOT THE TEXT COLOUR. Colouring the whole headline
    // meant a warning arrived as five lines of red on black, which is both the
    // least legible combination on a transflective screen in daylight and a
    // misuse of the one channel this app reserves for state. White text with a
    // coloured marker says the same thing and can actually be read.
    //
    // A FINDING THAT DOES NOT FIT IS COUNTED, NOT DROPPED. The band on a
    // Forerunner 55 holds about five lines, and the second finding was silently
    // discarded -- the watch showed one item with no hint that another existed,
    // while the same payload on a Fenix showed two. An app that quietly decides
    // which of your health findings you are allowed to see is worse than one
    // that shows fewer and says so.
    //
    private function drawFindings(dc as Dc, cx as Number, cy as Number, list as Array) as Void {
        // Findings live in the band between the card title and the page dots,
        // and they are centred in that band rather than on the screen.
        //
        // Centring on the screen put the first line through the word "Today" on
        // the Forerunner 55, and wrapping to a fixed 24 characters clipped it at
        // both ends -- "Resting HR 4 bpm above" rendered as "esting HR 4 bpm
        // above". Neither had ever been seen, because this card had never been
        // drawn on any watch before 1.3.1.
        var titleH  = dc.getFontHeight(Graphics.FONT_SMALL);
        var lineH   = dc.getFontHeight(Graphics.FONT_XTINY);
        var bandTop = 24 + titleH + 2;
        var bandBot = dc.getHeight() - 20;          // page dots sit below this
        var bandH   = bandBot - bandTop;
        if (bandH < lineH) { return; }

        // A round screen is narrowest at whichever end of the band is farther
        // from the centre. Wrapping to that width is slightly conservative and
        // cannot clip, wherever the block finally lands.
        var topOff = bandTop - cy;
        var botOff = bandBot - cy;
        if (topOff < 0) { topOff = -topOff; }
        if (botOff < 0) { botOff = -botOff; }
        var narrowest = topOff > botOff ? topOff : botOff;

        // The marker sits to the left of the first line of each finding, so the
        // wrap has to leave room for it or the dot pushes the text off-screen.
        var dotRadius = 3;
        var dotGap    = 6;
        var textWidth = narrowest - ((dotRadius * 2) + dotGap) * 2;
        if (textWidth < 40) { textWidth = narrowest; }

        // One line is reserved for the "+N more" footer whenever there is any
        // chance of needing it, so the footer can never be the thing that does
        // not fit.
        var maxLines = bandH / lineH;
        if (list.size() > 1 && maxLines > 2) { maxLines -= 1; }

        var lines    = [] as Array<String>;
        var markers  = [] as Array<Number>;   // severity colour, or -1 for none
        var rendered = 0;

        for (var i = 0; i < list.size(); i += 1) {
            var item = list[i];
            if (!(item instanceof Dictionary)) { continue; }

            var entry = item as Dictionary;
            var headline = entry.get("headline");
            if (headline == null || !(headline instanceof String)) { continue; }

            var wrapped = wrapToWidth(dc, headline as String, Graphics.FONT_XTINY, textWidth);

            // All of it, or none of it. Half a finding is a sentence cut in the
            // middle, which reads as a fault rather than as a summary.
            var needed = wrapped.size() + (lines.size() > 0 ? 1 : 0);
            if (lines.size() + needed > maxLines) { break; }

            if (lines.size() > 0) {
                lines.add("");
                markers.add(-1);
            }

            var color = severityColor(entry.get("severity"));
            for (var j = 0; j < wrapped.size(); j += 1) {
                lines.add(wrapped[j] as String);
                markers.add(j == 0 ? color : -1);
            }
            rendered += 1;
        }

        if (lines.size() == 0) { return; }

        // `hidden` is a reserved access modifier in Monkey C.
        var notShown = list.size() - rendered;
        if (notShown > 0) {
            lines.add(notShown.toString() + " "
                + (WatchUi.loadResource(Rez.Strings.FindingsMore) as String));
            markers.add(-1);
        }

        var blockH = lines.size() * lineH;
        var startY = bandTop + ((bandH - blockH) / 2);

        for (var i = 0; i < lines.size(); i += 1) {
            var text = lines[i] as String;
            if (text.length() == 0) { continue; }

            var y = startY + i * lineH;
            var isFooter = notShown > 0 && i == lines.size() - 1;

            dc.setColor(isFooter ? Palette.SECONDARY : Palette.PRIMARY,
                Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y, Graphics.FONT_XTINY, text, Graphics.TEXT_JUSTIFY_CENTER);

            var marker = markers[i] as Number;
            if (marker >= 0) {
                var half = dc.getTextWidthInPixels(text, Graphics.FONT_XTINY) / 2;
                dc.setColor(marker, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(cx - half - dotGap - dotRadius,
                    y + (lineH / 2) - Graphics.getFontDescent(Graphics.FONT_XTINY) / 2,
                    dotRadius);
            }
        }
    }

    private function severityColor(severity as Object or Null) as Number {
        if (severity != null && severity instanceof String) {
            var name = severity as String;
            if (name.equals("warn"))   { return Palette.HARD; }
            if (name.equals("notice")) { return Palette.CAUTION; }
        }
        return Palette.SECONDARY;
    }

    // -------------------------------------------------------------------------
    // Week card
    //
    // The one screen that answers the question training is actually planned in.
    // Every other card here is about today, and the store has been able to
    // compare this week against last week since the memory layer landed without
    // anything ever asking it.
    //
    // Four lines, each of which says nothing unless it has something real to
    // say. A missing metric is left out rather than drawn as a zero: an unworn
    // watch is not a training load of nothing, and rendering an absence as a
    // measurement is the mistake this project keeps making.
    // -------------------------------------------------------------------------

    private function drawWeekCard(dc as Dc, summary as Dictionary or Null) as Void {
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 24, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.CardWeek) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var week = summary == null ? null : summary.get("week");
        if (week == null || !(week instanceof Dictionary)) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.NoData) as String, "");
            return;
        }

        var w = week as Dictionary;
        var ready = w.get("ready");
        if (ready == null || !(ready instanceof Boolean) || !(ready as Boolean)) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.TodayGathering) as String,
                WatchUi.loadResource(Rez.Strings.WeekNeedTwo) as String);
            return;
        }

        var lines  = [] as Array<String>;
        var colors = [] as Array<Number>;
        var sessionsFull = null;

        var sessions = w.get("sessions");
        var minutes  = w.get("moving_minutes");
        if (sessions != null && sessions instanceof Number) {
            var sessionText = (sessions as Number).toString() + " "
                + (WatchUi.loadResource(
                    (sessions as Number) == 1 ? Rez.Strings.WeekSession : Rez.Strings.WeekSessions) as String);

            // The full form is decided after the layout is known, below: how
            // much room this line has depends on how many lines there are, and
            // a round screen narrows fast as the block grows upward.
            if (minutes != null && minutes instanceof Number && (minutes as Number) > 0) {
                sessionsFull = sessionText + "  " + formatDuration(minutes as Number);
            }
            lines.add(sessionText);
            colors.add(-1);   // the headline reports no state of its own
        }

        // Load, as a percentage against last week. Signed on purpose: "up 18%"
        // and "down 18%" are opposite pieces of news and an unsigned number
        // makes the reader work out which one they are looking at.
        var loadDelta = w.get("load_delta_pct");
        if (loadDelta != null && loadDelta instanceof Number) {
            var delta = loadDelta as Number;
            lines.add((WatchUi.loadResource(Rez.Strings.WeekLoad) as String) + " "
                + (delta >= 0 ? "+" : "") + delta.toString() + "%");
            // A big move in either direction is worth a mark. It was only
            // flagged when load went UP, so a 40% collapse -- the shape of an
            // illness or an injury week -- passed without one.
            var absDelta = delta < 0 ? -delta : delta;
            colors.add(absDelta >= 25 ? Palette.CAUTION : -1);
        }

        // The forecast, which is the only forward-looking number in the app.
        var verdict = w.get("forecast_verdict");
        var ratio   = w.get("forecast_ratio");
        if (verdict != null && verdict instanceof String && !(verdict as String).equals("unknown")) {
            var v = verdict as String;
            var ratioText = "";
            if (ratio != null) { ratioText = " " + metricText(ratio) + "x"; }

            var verdictRes = Rez.Strings.WeekOnTrack;
            var verdictColor = Palette.GOOD;
            if (v.equals("spike_ahead")) {
                verdictRes = Rez.Strings.WeekSpikeAhead;
                verdictColor = Palette.HARD;
            } else if (v.equals("detraining_ahead")) {
                verdictRes = Rez.Strings.WeekEasingOff;
                verdictColor = Palette.CAUTION;
            }

            lines.add((WatchUi.loadResource(verdictRes) as String) + ratioText);
            colors.add(verdictColor);
        }

        // Sleep debt, against this person's own usual night rather than eight
        // hours. Only shown once it is worth an hour of anyone's attention.
        // JSON numbers reach Monkey C as Number, Float or Double depending on
        // whether they carried a decimal point, so a debt of exactly 3 and a
        // debt of 3.4 arrive as different types. Calling toFloat() on the
        // dictionary value directly does not compile, and casting the wrong way
        // is a runtime crash rather than a wrong number.
        var debt = w.get("sleep_debt_h");
        if (debt != null && (debt instanceof Float || debt instanceof Double || debt instanceof Number)) {
            var debtHours = numberOf(debt);
            if (debtHours >= 1.0) {
                lines.add((WatchUi.loadResource(Rez.Strings.WeekSleepDebt) as String)
                    + " " + metricText(debt) + "h");
                colors.add(debtHours >= 5.0 ? Palette.HARD : Palette.CAUTION);
            }
        }

        // The race, if one is on the calendar. It belongs on this card rather
        // than on Today because it is a fact about the block, not about a day --
        // and because it is what makes the line above it readable: a falling
        // load ratio is a warning in January and the plan in a taper.
        var race = summary == null ? null : summary.get("race");
        if (race != null && race instanceof Dictionary) {
            var r = race as Dictionary;
            var name = r.get("text");
            var days = r.get("days_away");
            if (name != null && name instanceof String && days != null && days instanceof Number) {
                var away = days as Number;
                var raceLine = "";
                if (away == 0) {
                    raceLine = WatchUi.loadResource(Rez.Strings.RaceToday) as String;
                } else if (away == 1) {
                    raceLine = WatchUi.loadResource(Rez.Strings.RaceTomorrow) as String;
                } else {
                    raceLine = away.toString() + " "
                        + (WatchUi.loadResource(Rez.Strings.RaceDays) as String)
                        + " " + (name as String);
                }
                lines.add(raceLine);
                colors.add(away <= 7 ? Palette.CAUTION : -1);
            }
        }

        if (lines.size() == 0) {
            drawTodayMessage(dc, cx, cy,
                WatchUi.loadResource(Rez.Strings.NoData) as String, "");
            return;
        }

        var lineH = dc.getFontHeight(Graphics.FONT_TINY);
        var y = cy - ((lines.size() * lineH) / 2);


        // Now the top row's position is known, so the sessions line can take its
        // duration back if there is room for it whole.
        //
        // Measuring at the widest point instead was not enough: with a race on
        // the card the block is five lines, the top row sits higher, and a round
        // screen narrows fast as it climbs -- "4 sessions  3h 32m" fitted at
        // four lines and rendered "4 sessions  3h 3..." at five. Drop a whole
        // field before cutting a number in half, and decide it against the row
        // the line is actually drawn on.
        if (sessionsFull != null && lines.size() > 0) {
            var topOffset = y + lineH - Graphics.getFontDescent(Graphics.FONT_TINY) - cy;
            if (topOffset < 0) { topOffset = -topOffset; }
            var topStart = y - cy;
            if (topStart < 0) { topStart = -topStart; }
            var deepest = topOffset > topStart ? topOffset : topStart;
            if (dc.getTextWidthInPixels(sessionsFull as String, Graphics.FONT_TINY)
                    <= lineWidthAt(dc, deepest)) {
                lines[0] = sessionsFull as String;
            }
        }

        for (var i = 0; i < lines.size(); i += 1) {
            // The first line is the week's headline and stays in primary ink
            // even though it reports no state; everything below it is either
            // marked, or supporting detail in secondary.
            var marker = colors[i] as Number;
            var ink = (i == 0 || marker >= 0) ? Palette.PRIMARY : Palette.SECONDARY;
            drawMarkedLine(dc, cx, y, lines[i] as String, Graphics.FONT_TINY, ink, marker);
            y += lineH;
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

        // "No insight today" is a claim about today. It was also what a user
        // with no API key saw, every day, forever -- ai_insight is null in both
        // cases and the card could not tell them apart. Say which it is.
        var insight = WatchUi.loadResource(
            summary != null && !isAiConfiguredIn(summary)
                ? Rez.Strings.AiNotSetUp
                : Rez.Strings.AiNoInsight) as String;
        if (summary != null) {
            var ai = summary.get("ai_insight");
            if (ai != null && ai instanceof String) {
                insight = ai as String;
            }
        }

        var lines  = wrapToWidth(dc, insight, Graphics.FONT_XTINY, 0);
        var lineH  = dc.getFontHeight(Graphics.FONT_XTINY);
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

        // All four cells are now graded the same way, which two of them were
        // not: sleep and VO2 max were hard-coded white while recovery and
        // stress were coloured, so half the grid claimed a verdict and half
        // stayed silent with nothing to tell them apart. The colour also came
        // from parseNumber() reading the number back out of the string that had
        // just been formatted for display -- it stops at the first non-digit,
        // so "6.3h" was graded as 6.
        //
        // VO2 max stays ungraded on purpose: it has no band in this product,
        // and a colour would be a verdict nobody computed.
        drawOverviewCell(dc, leftX,  topY,    WatchUi.loadResource(Rez.Strings.LabelRecovery) as String, recValue,    stateColor("recovery"));
        drawOverviewCell(dc, rightX, topY,    WatchUi.loadResource(Rez.Strings.LabelSleep) as String,    sleepValue,  stateColor("sleep"));
        drawOverviewCell(dc, leftX,  bottomY, WatchUi.loadResource(Rez.Strings.LabelStress) as String,   stressValue, stateColor("stress"));
        drawOverviewCell(dc, rightX, bottomY, WatchUi.loadResource(Rez.Strings.LabelVo2) as String,      vo2Value,    Palette.PRIMARY);
    }

    // JSON numbers arrive as Float whenever the server sent a decimal, and
    // Float.toString() renders six decimal places: sleep of 6.3 hours drew as
    // "6.300000h" on the watch, which then overflowed its cell. Every metric
    // that can be fractional goes through this.
    /** A payload number as a Float, whichever numeric type it arrived as.
        JSON without a decimal point parses to Number, with one to Float or
        Double, so the same field is a different type on different days. */
    private function numberOf(value) as Float {
        if (value instanceof Float || value instanceof Double) {
            return (value as Float).toFloat();
        }
        if (value instanceof Number) {
            return (value as Number).toFloat();
        }
        return 0.0;
    }

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

        var color = hasScore ? stateColor("recovery") : Palette.PRIMARY;
        var cx = dc.getWidth() / 2;
        var cy = dc.getHeight() / 2;

        if (roundScreen && hasScore) {
            // The ring was a fixed inset from the screen edge, which put its top
            // at y=36 -- inside the title, which occupies y=24 to roughly y=52.
            // The score arc drew straight through the word "Recovery". Size it
            // to whatever clears the title instead, so it stays clear on any
            // screen and with any system font.
            var radius = ringRadiusFor(dc);
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
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
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(20, cy + 8, barWidth, 8);
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(20, cy + 8, fillWidth, 8);
        }

        // "No data" must not go anywhere near FONT_NUMBER_HOT: that face has
        // digits and separators only, so every letter in it draws as an empty
        // box. Same trap as the Sleep card's "6.3h".
        var scoreText = hasScore
            ? score.toString()
            : WatchUi.loadResource(Rez.Strings.NoData) as String;

        // Size the number to the space the rest of the card needs, rather than
        // taking the biggest face and letting everything below it fall off the
        // screen.
        //
        // FONT_NUMBER_HOT is about 60 px on the 208 px Forerunner 55, and the
        // card also has to fit a label and the resting/max heart rate above the
        // page dots. Taking the big face unconditionally pushed "Rest 48" into
        // the dot row, where the two drew through each other -- one more variant
        // of the fixed-offset bug that produced six of the last seven layout
        // faults here. On a fenix there is room for the big face and it is used.
        var scoreFont = Graphics.FONT_MEDIUM;
        if (hasScore) {
            var faces = [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM,
                         Graphics.FONT_LARGE, Graphics.FONT_MEDIUM] as Array<Graphics.FontDefinition>;
            scoreFont = faces[faces.size() - 1];
            for (var f = 0; f < faces.size(); f += 1) {
                if (recoveryStackFits(dc, faces[f], label as String, roundScreen)) {
                    scoreFont = faces[f];
                    break;
                }
            }
        }

        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, cy - 8, scoreFont, scoreText,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Everything below the score is stacked off the score's real height.
        //
        // The label was at a fixed cy+36 and the heart rate at cy+62, which are
        // sized for a small screen: FONT_NUMBER_HOT is about 60 px tall on the
        // 208 px Forerunner 55 and roughly twice that on a 454 px fenix, where
        // "Ready" printed through the bottom of the "91". Measure the number,
        // then put the label under it.
        var labelY = recoveryLabelY(dc, scoreFont, label as String,
            roundScreen && hasScore);

        if ((label as String).length() > 0) {
            dc.setColor(dimColor(), Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, labelY, Graphics.FONT_TINY,
                fitLine(dc, label as String, Graphics.FONT_TINY, labelY),
                Graphics.TEXT_JUSTIFY_CENTER);
        }

        drawRestingHeartRate(dc, summary, cx,
            labelY + Graphics.getFontHeight(Graphics.FONT_TINY) + 2,
            roundScreen && hasScore);
    }

    /** The bottom of the usable area on a card: above the page dots, which sit
        at height - 12 with a radius of 3. */
    private function cardContentBottom(dc as Dc) as Number {
        return dc.getHeight() - 20;
    }

    //
    // Where the recovery label goes, given the font the score is drawn in.
    //
    // One function, because the fit test and the drawing have to agree. They
    // did not: the test stacked label under score and declared it fits, the
    // drawing then pushed the label below the ring for a horizontal collision
    // the test knew nothing about, and the heart-rate line underneath ended up
    // in the page dots -- with the biggest score font still selected, because
    // the test had approved a layout that was never drawn.
    //
    // Two separate constraints, both real:
    //   * clear the score, whose height varies by a factor of two across devices
    //   * clear the ring, which is a HORIZONTAL problem -- a circle narrows as
    //     it descends, so a label can sit well inside the ring's height and
    //     still have the arc drawn through it. On the 208 px Forerunner 55 the
    //     ring closes to about 21 px either side of centre at the label's row
    //     and "Ready" is 30 px wide.
    //
    private function recoveryLabelY(
        dc as Dc,
        scoreFont as Graphics.FontDefinition,
        label as String,
        ringDrawn as Boolean
    ) as Number {
        var cy = dc.getHeight() / 2;
        var scoreBottom = cy - 8 + (Graphics.getFontHeight(scoreFont) / 2)
            - Graphics.getFontDescent(scoreFont);
        var labelY = scoreBottom + 6;
        if (label.length() == 0) { return labelY; }

        return clearOfRing(dc, labelY, label, Graphics.FONT_TINY, ringDrawn);
    }

    //
    // Move a line of text below the ring if the arc would be drawn through it.
    //
    // A circle NARROWS as it descends, so a row can sit comfortably inside the
    // ring's height and still be too wide for the ring at that row. The label
    // has been tested this way since 1.3.2; the heart-rate line underneath it
    // never was, and on the Forerunner 55 "Resting 48  Max 178" was drawn with
    // the arc straight through it -- a struck-through health metric, which
    // reads as a rendering fault.
    //
    // One function now, used by both, for the same reason the label test and
    // the drawing were merged: two places that must agree about where the ring
    // is will eventually disagree.
    //
    private function clearOfRing(
        dc as Dc,
        y as Number,
        text as String,
        font as Graphics.FontDefinition,
        ringDrawn as Boolean
    ) as Number {
        if (!ringDrawn || text.length() == 0) { return y; }

        var cy         = dc.getHeight() / 2;
        var ringRadius = ringRadiusFor(dc);
        if (y >= cy + ringRadius) { return y; }

        // The deepest point the text reaches, as a distance from the centre --
        // which is where the ring is narrowest for this row.
        var deepest = y + Graphics.getFontHeight(font) - Graphics.getFontDescent(font) - cy;
        if (deepest < 0) { deepest = -deepest; }

        var halfChord = deepest >= ringRadius
            ? 0
            : Math.sqrt((ringRadius * ringRadius) - (deepest * deepest)).toNumber();
        var halfText = dc.getTextWidthInPixels(text, font) / 2;

        return (halfText + 4 > halfChord) ? cy + ringRadius + 4 : y;
    }

    /** True when a recovery score in this font leaves room for the label and the
        heart-rate line above the page dots, as they will actually be placed. */
    private function recoveryStackFits(
        dc as Dc,
        scoreFont as Graphics.FontDefinition,
        label as String,
        ringDrawn as Boolean
    ) as Boolean {
        var labelY = recoveryLabelY(dc, scoreFont, label, ringDrawn);
        var hrY = label.length() > 0
            ? labelY + Graphics.getFontHeight(Graphics.FONT_TINY) + 2
            : labelY;

        // Tested against the same ring the drawing will clear, using the widest
        // shape this line takes. The fit test and the drawing disagreeing about
        // the ring is precisely the fault that put "Rest 48" into the page dots
        // with the biggest score font still selected.
        hrY = clearOfRing(dc, hrY, "Resting 000  Max 000", Graphics.FONT_XTINY, ringDrawn);

        return hrY + Graphics.getFontHeight(Graphics.FONT_XTINY) <= cardContentBottom(dc);
    }

    /** The recovery ring's radius. One definition, because both the arc and the
        label under it have to agree on where the ring is. */
    private function ringRadiusFor(dc as Dc) as Number {
        var titleBottom = 24 + dc.getFontHeight(Graphics.FONT_SMALL);
        var maxRadius   = (dc.getWidth() / 2) - 12;
        var clearance   = (dc.getHeight() / 2) - titleBottom - 6;
        return clearance < maxRadius ? clearance : maxRadius;
    }

    // Resting and max heart rate share the Recovery card: resting HR is how the
    // recovery score is largely derived, so the two are read together.
    private function drawRestingHeartRate(
        dc as Dc,
        summary as Dictionary or Null,
        cx as Number,
        y as Number,
        ringDrawn as Boolean
    ) as Void {
        if (summary == null) { return; }

        var heartRate = summary.get("heart_rate");
        if (heartRate == null || !(heartRate instanceof Dictionary)) { return; }

        var hd      = heartRate as Dictionary;
        var resting = hd.get("resting");
        var max     = hd.get("max");
        if (resting == null) { return; }

        var maxLabel = WatchUi.loadResource(Rez.Strings.LabelMax) as String;
        var text = WatchUi.loadResource(Rez.Strings.LabelResting) as String + " " + resting.toString();
        if (max != null) {
            text = text + "  " + maxLabel + " " + max.toString();
        }

        // Drop a whole field before cutting a number in half.
        //
        // "Resting 48  Max 178" is wider than a 208 px round screen allows at
        // this height, and plain truncation rendered "Resting 48  Ma..." --
        // spending the space on the word and throwing away the maximum heart
        // rate, which is the only part the user cannot already guess. Shortening
        // the label to "Rest" bought enough room on most screens.
        //
        // It is not enough on the Forerunner 55 once the recovery label moves
        // below the ring: this line then sits about 83 px under centre, where a
        // 208 px circle is 115 px wide, and even "Rest 48  Max 178" was cut to
        // "Rest 48 ...". An ellipsis on a health metric is worse than an absent
        // one -- it looks like a rendering fault and tells the reader nothing --
        // so the last step drops the maximum and shows the resting rate whole.
        // THE ROW IS SETTLED BEFORE THE TEXT IS FITTED TO IT, and the order
        // matters. Fitting first and moving afterwards measured the width
        // available at a row this line no longer occupies: pushing it clear of
        // the ring drops it into a narrower part of the circle, and "Resting 48
        // Max 178" came out as "Resting 48  Max 1...". The ring test uses the
        // longest form the line can take, so clearance is decided on the worst
        // case rather than on whatever happened to survive trimming.
        y = clearOfRing(dc, y, text, Graphics.FONT_XTINY, ringDrawn);

        var short = WatchUi.loadResource(Rez.Strings.LabelRestingShort) as String;
        var available = lineWidthAt(dc,
            y + Graphics.getFontHeight(Graphics.FONT_XTINY)
              - Graphics.getFontDescent(Graphics.FONT_XTINY) - (dc.getHeight() / 2));

        if (max != null && dc.getTextWidthInPixels(text, Graphics.FONT_XTINY) > available) {
            text = short + " " + resting.toString() + "  " + maxLabel + " " + max.toString();
        }
        if (dc.getTextWidthInPixels(text, Graphics.FONT_XTINY) > available) {
            text = short + " " + resting.toString();
        }

        // Secondary, not graded.
        //
        // This one drawText holds BOTH the resting and the maximum heart rate,
        // and the old colour graded the resting one and then painted the whole
        // string with it -- so a green line asserted something about a maximum
        // nobody had assessed. It is supporting detail under the recovery
        // score, which carries this card's verdict; resting heart rate is
        // graded where it can be said properly, on Today and in the dashboard,
        // against this person's own median rather than an absolute rate.
        dc.setColor(Palette.SECONDARY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_XTINY,
            fitLine(dc, text, Graphics.FONT_XTINY, y),
            Graphics.TEXT_JUSTIFY_CENTER);
    }

    // -------------------------------------------------------------------------
    // Card titles & data
    // -------------------------------------------------------------------------

    private function getCardTitle(cardId as String) as String {
        if (cardId.equals(Cards.SLEEP))    { return WatchUi.loadResource(Rez.Strings.CardSleep) as String; }
        if (cardId.equals(Cards.ACTIVITY)) { return WatchUi.loadResource(Rez.Strings.CardActivity) as String; }
        return WatchUi.loadResource(Rez.Strings.CardStress) as String;
    }

    /** The colour for a metric the server has already graded. */
    private function stateColor(key as String) as Number {
        var app = Application.getApp() as TrainBudApp;
        return Palette.forState(app.getState(key));
    }

    private function getCardData(dc as Dc, cardId as String, summary as Dictionary) as Dictionary {
        var result = {
            :value    => WatchUi.loadResource(Rez.Strings.NoData) as String,
            :subtitle => "",
            :footnote => "",
            :color    => Palette.PRIMARY
        };

        if (cardId.equals(Cards.SLEEP)) {
            var sleep = summary.get("sleep");
            if (sleep != null && sleep instanceof Dictionary) {
                var sd = sleep as Dictionary;
                var hours = sd.get("hours");
                var score = sd.get("score");
                var lbl   = sd.get("label");
                if (hours != null) {
                    result[:value] = metricText(hours) + "h";
                    // Graded on the hours against this person's own band, not
                    // on Garmin's sleep score: the score is what the value on
                    // screen is NOT, and colouring a duration by a different
                    // measurement is how the card came to disagree with itself.
                    result[:color] = stateColor("sleep");
                }
                if (score != null) {
                    result[:subtitle] = "Score " + score.toString();
                } else if (lbl != null) {
                    result[:subtitle] = lbl as String;
                }
            }

            // Last night against this person's own usual night.
            //
            // A single night's hours is the least informative sleep number
            // there is: it cannot tell a late film from a fortnight of five-hour
            // nights, and it says nothing at all unless you already know what
            // this person normally sleeps. The footnote supplies exactly that,
            // and it is their own median rather than eight hours -- telling a
            // habitual seven-hour sleeper they are an hour down every night of
            // their life is how a health app becomes noise.
            var week = summary.get("week");
            if (week != null && week instanceof Dictionary) {
                var wd = week as Dictionary;
                var habitual = wd.get("sleep_habitual_h");
                if (habitual != null) {
                    var note = (WatchUi.loadResource(Rez.Strings.SleepUsually) as String)
                        + " " + metricText(habitual) + "h";
                    var consistency = wd.get("sleep_consistency");
                    if (consistency != null && consistency instanceof String) {
                        var c = consistency as String;
                        var word = null;
                        if (c.equals("erratic")) {
                            word = WatchUi.loadResource(Rez.Strings.SleepErratic) as String;
                        } else if (c.equals("variable")) {
                            word = WatchUi.loadResource(Rez.Strings.SleepVariable) as String;
                        } else if (c.equals("steady")) {
                            word = WatchUi.loadResource(Rez.Strings.SleepSteady) as String;
                        }

                        // Only if it fits whole. "Usually 7.2h · variable" is
                        // wider than a 208 px screen at this height and was
                        // rendered "Usually 7.2h · v...", which reads as a
                        // broken layout and tells the user nothing. The
                        // habitual figure is the part they cannot guess, so it
                        // is the part that survives.
                        if (word != null) {
                            var full = note + " · " + (word as String);
                            if (dc.getTextWidthInPixels(full, Graphics.FONT_XTINY)
                                    <= lineWidthAt(dc, (dc.getHeight() / 2) - 36)) {
                                note = full;
                            }
                        }
                    }
                    result[:footnote] = note;
                }
            }
            return result;
        }

        if (cardId.equals(Cards.ACTIVITY)) {
            var activity = summary.get("activity");
            if (activity != null && activity instanceof Dictionary) {
                var ad = activity as Dictionary;
                var name     = ad.get("name");
                var distance = ad.get("distance_km");
                var dur      = ad.get("duration_min");
                var avgHr    = ad.get("avg_hr");
                var parts    = [] as Array<String>;
                // Not truncated here. drawFittedValue steps down through the
                // fonts and then trims by measured width, which is the only way
                // to know what fits; cutting to 14 characters first threw away
                // room that a smaller font would have had. This was the last
                // open item on the Activity card.
                if (name != null) { result[:value] = name as String; }
                if (dur != null)      { parts.add(formatDuration(dur as Number)); }
                // Connect reports 0 km for workouts that do not cover ground, so
                // a strength session read "1h 23m . 0 km . 114 bpm". A distance
                // of zero is an absence, not a measurement.
                // The server writes the distance in the user's own units and
                // sends it as text; distance_km stays kilometres forever
                // because a watch already on a wrist reads that field. Older
                // servers send no display string, so the kilometre form is the
                // fallback rather than the default.
                var shown = ad.get("distance_display");
                if (shown != null && shown instanceof String) {
                    parts.add(shown as String);
                } else if (distance != null && (distance as Float) > 0) {
                    parts.add(metricText(distance) + " km");
                }
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
            if (avg != null) { result[:value] = metricText(avg); result[:color] = stateColor("stress"); }
            if (lbl != null) { result[:subtitle] = lbl as String; }
        }

        return result;
    }

    // -------------------------------------------------------------------------
    // Colour
    //
    // There are no thresholds in this file any more.
    //
    // recoveryColor, sleepColor, stressColor and heartRateColor used to live
    // here, each with its own hard-coded bands. Four problems came with them.
    // The wrist and the dashboard could disagree about whether the same score
    // was good, and nothing reconciled them. Per-user bands were impossible
    // without shipping the numbers to the device and implementing the same
    // comparison twice, once in a language with no tests here. heartRateColor
    // coloured a string holding BOTH resting and max heart rate while grading
    // only the resting one, so the colour made a claim about a number nobody
    // had assessed. And a missing value fell through to white, which is the
    // same as "graded and unremarkable" -- an absence rendered as a
    // measurement.
    //
    // The server grades and sends `states`; Palette.forState turns a state into
    // a colour; anything ungraded stays PRIMARY and says nothing.
    // -------------------------------------------------------------------------

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

    // The card value is drawn in FONT_NUMBER_HOT, which is sized for two or
    // three digits. On the Activity card the value is the workout's name, and
    // "Strength" already ran off both edges of a 390 px round screen -- the old
    // guard was truncate(name, 14), which counts characters, and characters are
    // not pixels. Step down through the fonts until one fits, and only then
    // trim, measuring as we go.
    private function drawFittedValue(dc as Dc, cx as Number, cy as Number, text as String) as Void {
        var maxWidth = (dc.getWidth() * 85) / 100;

        // The FONT_NUMBER_* faces carry digits and separators and nothing else,
        // so any letter in them draws as an empty box. The Sleep card's "6.3h"
        // rendered as "6.3" followed by a hollow yellow rectangle on the
        // Forerunner 55 -- and the box has a width, so the fits-in-this-font
        // check passed and it never stepped down to a font with letters.
        // Only offer the number faces when there is nothing but a number.
        var fonts = isNumericText(text)
            ? ([
                Graphics.FONT_NUMBER_HOT,
                Graphics.FONT_NUMBER_MEDIUM,
                Graphics.FONT_LARGE,
                Graphics.FONT_MEDIUM,
                Graphics.FONT_SMALL
              ] as Array<Graphics.FontDefinition>)
            : ([
                Graphics.FONT_LARGE,
                Graphics.FONT_MEDIUM,
                Graphics.FONT_SMALL,
                Graphics.FONT_TINY
              ] as Array<Graphics.FontDefinition>);

        for (var i = 0; i < fonts.size(); i += 1) {
            var font = fonts[i];
            if (dc.getTextWidthInPixels(text, font) <= maxWidth) {
                dc.drawText(cx, cy, font, text,
                    Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
                return;
            }
        }

        // Longer than the smallest font can render: trim by measured width.
        var smallest = fonts[fonts.size() - 1];
        dc.drawText(cx, cy, smallest, fitToWidth(dc, text, smallest, maxWidth),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function fitToWidth(
        dc as Dc,
        text as String,
        font as Graphics.FontDefinition,
        maxWidth as Number
    ) as String {
        // lineWidthAt returns 0 at the very top and bottom of a round screen.
        // Trimming to a zero budget would eat the whole string.
        if (maxWidth <= 0) { return text; }
        if (dc.getTextWidthInPixels(text, font) <= maxWidth) { return text; }

        var trimmed = text;
        while (trimmed.length() > 1) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
            if (dc.getTextWidthInPixels(trimmed + "...", font) <= maxWidth) {
                return trimmed + "...";
            }
        }

        return trimmed;
    }

    /** Truncates a single line to whatever fits at the height it is drawn.

        Text is drawn top-anchored, so it spans yTop to yTop + fontHeight, and
        on a round screen the edge of that span furthest from the centre is the
        one that clips. Measuring only at yTop reported more room than the line
        actually had. */
    private function fitLine(
        dc as Dc,
        text as String,
        font as Graphics.FontType,
        yTop as Number
    ) as String {
        // The glyphs, not the font box. getFontHeight is ascent plus descent,
        // and the descent is empty space under most characters -- charging the
        // line for it made "Rest 48  Max 178" look 20 px wider than it draws,
        // and it was truncated with room to spare.
        var cy  = dc.getHeight() / 2;
        var top = yTop - cy;
        var bot = yTop + Graphics.getFontHeight(font) - Graphics.getFontDescent(font) - cy;
        if (top < 0) { top = -top; }
        if (bot < 0) { bot = -bot; }
        return fitToWidth(dc, text, font, lineWidthAt(dc, top > bot ? top : bot));
    }

    /** True when every character is one the FONT_NUMBER_* faces actually have:
        digits, and the separators that appear between them. */
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

    // How wide a line can be at a given distance from the vertical centre.
    //
    // A round screen is a circle, so a line near the top or bottom has far less
    // room than one through the middle: on the 208 px Forerunner 55 the centre
    // fits about 34 characters and a line 60 px above it fits 27. Wrapping to a
    // fixed character count ignored that, and "Cannot reach server" rendered as
    // "annot reach serve" -- a character lost off each end, the same failure the
    // old single-line "Pairing failed" message had.
    private function lineWidthAt(dc as Dc, dyFromCenter as Number) as Number {
        var w = dc.getWidth();
        if (!isRoundScreen(dc)) { return w - 12; }

        var r  = w / 2;
        var dy = dyFromCenter < 0 ? -dyFromCenter : dyFromCenter;
        if (dy >= r) { return 0; }

        var half  = Math.sqrt((r * r) - (dy * dy)).toNumber();
        var avail = (half * 2) - 10;   // a small margin off the curve
        return avail < 0 ? 0 : avail;
    }

    /** Wraps to the pixels actually available at dyFromCenter, in this font, on
        this screen, rather than to a character count guessed per device. */
    private function wrapToWidth(
        dc as Dc,
        text as String,
        font as Graphics.FontType,
        dyFromCenter as Number
    ) as Array<String> {
        var pixels = lineWidthAt(dc, dyFromCenter);
        var len    = text.length();
        if (len == 0) { return wrapText(text, 1); }

        var textW = dc.getTextWidthInPixels(text, font);
        if (textW <= 0 || pixels <= 0) { return wrapText(text, len); }

        // Average width over this string, a far better estimate for this text
        // than any fixed per-font constant.
        var perChar = textW.toFloat() / len;
        var chars   = (pixels / perChar).toNumber();
        return wrapText(text, chars < 1 ? 1 : chars);
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
