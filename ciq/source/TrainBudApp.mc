import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

//
// How a pairing attempt failed, in the terms the user can act on.
//
// Every failure used to render one screen reading "Pairing failed. Tap to
// retry.", which is equally true of a watch with no phone, a mistyped URL, a
// dead tunnel answering 404, a captive portal answering 200 with HTML, and a
// healthy server that said no. Those need four different actions from the user
// and the message named none of them. The reporter on the Forerunner 55 saw
// that screen because the build shipped a default URL pointing at a tunnel that
// no longer existed; NOT_SERVER would have said so.
//
// A module rather than constants on the app class, so the view can name them
// without holding an instance -- the same reason Cards exists.
//
module PairFail {
    const UNREACHABLE = 0;  // nothing answered: transport error or 5xx
    const NOT_SERVER  = 1;  // something answered, but it is not us
    const REFUSED     = 2;  // our server answered and declined
}

class TrainBudApp extends Application.AppBase {

    // Storage keys
    const STORAGE_SUMMARY_KEY    = "summary";
    const STORAGE_UPDATED_AT_KEY = "updated_at";
    const STORAGE_CACHED_AT_KEY  = "cached_at";
    const STORAGE_API_KEY        = "api_key";
    const STORAGE_SERVER_URL     = "server_url";

    // Carousel layout lives in Cards.mc — see that module for the card order.
    const CARD_COUNT = Cards.COUNT;

    const FETCH_TIMEOUT_MS  = 10000;
    const PAIR_POLL_MS      = 5000;
    const PROMPT_POLL_MS    = 3000;
    const PROMPT_TIMEOUT_MS = 30000;

    // Preset prompts (must match AskPrompt* strings)
    const PROMPT_COUNT = 5;

    // Stamped into pairing telemetry so the server log names the exact binary
    // that is running. Guessing which build the simulator had loaded wasted
    // several cycles.
    const BUILD_ID = "1.3.1-setup-screen";

    // Console tracing. The simulator's CIQ_LOG.YML records crashes only, but
    // System.println goes to the monkeydo console, which nobody had been
    // reading — a day was spent inferring control flow from server traffic that
    // this would have shown directly. Flip to false for the store build; see
    // the debug checklist in ciq/STORE-LISTING.md.
    const DEBUG_LOG = false;

    // Sent on every request. The ngrok free tier answers any GET whose
    // User-Agent looks like a browser with an HTML interstitial under a 200,
    // and Connect IQ's User-Agent is "Mozilla/5.0" and cannot be changed. The
    // watch then reports -400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE, the
    // request never reaches the server, and the server log shows nothing --
    // which reads exactly like a watch that sent nothing at all. POSTs are not
    // intercepted, which is why pairing could fetch a code but never poll for
    // its status, and why the summary fetch failed the same silent way.
    // Meaningless to any other host, so it costs nothing to always send it.
    const SKIP_INTERSTITIAL = "1";

    private var _summary    as Dictionary or Null = null;
    private var _status     as String = "idle";
    private var _cardIndex  as Number = 0;
    private var _updatedAt  as String or Null = null;
    private var _cachedAt   as Number or Null = null;

    // Pairing state
    // Last transport/HTTP code from a failed pairing attempt. Without this every
    // failure rendered the same "Pairing failed" screen, so a phone that was not
    // connected looked identical to a server that was down.
    private var _pairErrorCode as Number or Null = null;
    private var _pairFailClass as Number = PairFail.UNREACHABLE;

    // First slice of the response body when pairing fails with a 2xx. A 200 with
    // an unexpected body means something answered that is not our server — a
    // proxy, a captive portal, or an error page — and the only way to identify
    // it from the wrist is to show what actually came back.
    private var _pairErrorBody as String or Null = null;

    // Poll telemetry, surfaced on the pairing screen so a silently failing poll
    // is visible rather than looking like "not approved yet".
    // Attempts counts calls to pollPairStatus; count counts callbacks that came
    // back. Only one counter existed, on the callback, so "the poll function
    // never ran" and "it ran and was discarded on the device" were the same
    // reading — which is most of why this bug survived a day of work.
    private var _pairPollAttempts as Number = 0;
    private var _pairPollCount as Number = 0;
    private var _pairRequestCount as Number = 0;
    private var _pairPollCode  as Number or Null = null;

    private var _pairCode      as String or Null = null;
    private var _pairExpiresAt as Number or Null = null;
    private var _pairTimer     as Timer.Timer or Null = null;

    // Prompt state
    private var _promptJobId      as String or Null = null;
    private var _promptResult     as String or Null = null;
    private var _promptStatus     as String = "idle";
    private var _promptTimer      as Timer.Timer or Null = null;
    private var _promptTimeoutTimer as Timer.Timer or Null = null;
    private var _promptPageIndex  as Number = 0;
    private var _promptPageCount  as Number = 0;

    // Why the last prompt failed, as the server described it.
    //
    // The server puts a real reason in the job record -- on this install, every
    // prompt ever submitted failed with "ANTHROPIC_API_KEY not configured" --
    // and the watch read only the status field and drew "AI unavailable". The
    // one fact that would have told the user what to do was on the wire and
    // thrown away, which is exactly what the single "Pairing failed" screen did.
    private var _promptError as String or Null = null;

    // Ask AI menu state
    private var _askMenuIndex     as Number = 0;

    private var _fetchTimer as Timer.Timer or Null = null;

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary or Null) as Void {
    }

    function onStop(state as Dictionary or Null) as Void {
        stopFetchTimer();
        stopPairTimer();
        stopPromptTimers();
    }

    function getInitialView() {
        return [ new TrainBudView(), new TrainBudDelegate() ];
    }

    // From API level 4.0.0 an app without a glance view does not appear in the
    // device's glance list at all. The view reads the cached summary directly
    // from storage so the glance scope stays small — see TrainBudGlanceView.
    (:glance)
    function getGlanceView() {
        return [ new TrainBudGlanceView() ];
    }

    // -------------------------------------------------------------------------
    // Accessors
    // -------------------------------------------------------------------------

    function getSummary() as Dictionary or Null { return _summary; }
    function getStatus()  as String             { return _status; }
    function getCardIndex() as Number           { return _cardIndex; }
    function getUpdatedAt() as String or Null   { return _updatedAt; }
    function getCachedAt()  as Number or Null   { return _cachedAt; }
    function getCardCount() as Number           { return CARD_COUNT; }

    function setPairCode(code as String or Null) as Void { _pairCode = code; }
    function getPairCode() as String or Null             { return _pairCode; }
    function getPairExpiresAt() as Number or Null        { return _pairExpiresAt; }

    function getPromptStatus()    as String             { return _promptStatus; }
    function getPromptError()     as String or Null     { return _promptError; }

    /** Whether the server has an AI key at all.
     *
     *  Absent from summaries produced by a server older than 1.3.1, and from
     *  any cached before this field existed. Missing is treated as configured,
     *  so an old server keeps its previous behaviour rather than being reported
     *  as unconfigured on no evidence.
     */
    function isAiConfigured() as Boolean {
        if (_summary == null) { return true; }
        var flag = _summary.get("ai_configured");
        if (flag == null || !(flag instanceof Boolean)) { return true; }
        return flag as Boolean;
    }
    function getPromptResult()    as String or Null     { return _promptResult; }
    function getPromptPageIndex() as Number             { return _promptPageIndex; }
    function getPromptPageCount() as Number             { return _promptPageCount; }
    function getAskMenuIndex()    as Number             { return _askMenuIndex; }

    function setStatus(status as String) as Void  { _status = status; }
    function setSummary(data as Dictionary or Null) as Void {
        _summary = data;

        // A new summary can carry fewer prompts than the last one, which would
        // leave the menu cursor pointing past the end of the array.
        if (_askMenuIndex >= getPromptCount()) {
            _askMenuIndex = 0;
        }
    }
    function setUpdatedAt(v as String or Null) as Void { _updatedAt = v; }
    function setCachedAt(v as Number or Null) as Void  { _cachedAt = v; }

    function nextCard() as Void {
        _cardIndex = (_cardIndex + 1) % CARD_COUNT;
    }

    function prevCard() as Void {
        _cardIndex = (_cardIndex + CARD_COUNT - 1) % CARD_COUNT;
    }

    function nextPromptPage() as Void {
        if (_promptPageIndex < _promptPageCount - 1) {
            _promptPageIndex += 1;
        }
    }

    function prevPromptPage() as Void {
        if (_promptPageIndex > 0) {
            _promptPageIndex -= 1;
        }
    }

    function nextAskMenuItem() as Void {
        _askMenuIndex = (_askMenuIndex + 1) % getPromptCount();
    }

    function prevAskMenuItem() as Void {
        var count = getPromptCount();
        _askMenuIndex = (_askMenuIndex + count - 1) % count;
    }

    // -------------------------------------------------------------------------
    // Stored credentials
    // -------------------------------------------------------------------------

    // The user's setting wins over the stored value.
    //
    // This used to read Storage first and only fall back to the setting, so once
    // a URL had been stored — by a pairing, or by an earlier build — editing
    // Server URL in the app settings did nothing at all and the app kept calling
    // the old address. Storage remains the fallback for the value handed back by
    // the server during pairing, which is what keeps the watch working when no
    // setting has been entered.
    function getServerUrl() as String or Null {
        var prop = Properties.getValue("ServerUrl");
        if (prop != null && prop instanceof String && (prop as String).length() > 0) {
            return prop as String;
        }
        var stored = Storage.getValue(STORAGE_SERVER_URL);
        if (stored != null && stored instanceof String && (stored as String).length() > 0) {
            return stored as String;
        }
        return null;
    }

    function getApiKey() as String or Null {
        var stored = Storage.getValue(STORAGE_API_KEY);
        if (stored != null && stored instanceof String) {
            return stored as String;
        }
        return null;
    }

    function saveCredentials(apiKey as String, serverUrl as String) as Void {
        Storage.setValue(STORAGE_API_KEY, apiKey);
        Storage.setValue(STORAGE_SERVER_URL, serverUrl);
    }

    // -------------------------------------------------------------------------
    // Health summary fetch
    // -------------------------------------------------------------------------

    function loadCachedSummary() as Boolean {
        var cached      = Storage.getValue(STORAGE_SUMMARY_KEY);
        var cachedUpdAt = Storage.getValue(STORAGE_UPDATED_AT_KEY);
        var cachedAt    = Storage.getValue(STORAGE_CACHED_AT_KEY);

        if (cached == null || !(cached instanceof Dictionary)) {
            return false;
        }

        setSummary(cached as Dictionary);
        setUpdatedAt(cachedUpdAt != null ? cachedUpdAt as String : null);
        setCachedAt(cachedAt != null ? cachedAt as Number : null);
        setStatus("stale");
        WatchUi.requestUpdate();
        return true;
    }

    private function persistSummary(data as Dictionary) as Void {
        var updatedAt = data.get("updated_at");
        var now = Time.now().value();
        Storage.setValue(STORAGE_SUMMARY_KEY, data);
        Storage.setValue(STORAGE_CACHED_AT_KEY, now);
        setCachedAt(now);
        if (updatedAt != null) {
            Storage.setValue(STORAGE_UPDATED_AT_KEY, updatedAt as String);
        }
    }

    private function stopFetchTimer() as Void {
        if (_fetchTimer != null) {
            _fetchTimer.stop();
            _fetchTimer = null;
        }
    }

    private function startFetchTimer() as Void {
        stopFetchTimer();
        _fetchTimer = new Timer.Timer();
        _fetchTimer.start(method(:onFetchTimeout), FETCH_TIMEOUT_MS, false);
    }

    function onFetchTimeout() as Void {
        if (!_status.equals("loading")) { return; }
        if (!loadCachedSummary()) {
            setStatus("error");
            WatchUi.requestUpdate();
        }
    }

    function fetchSummary() as Void {
        var serverUrl = getServerUrl();
        var apiKey    = getApiKey();

        if (serverUrl == null || serverUrl.length() == 0) {
            if (!loadCachedSummary()) {
                setStatus("config");
                WatchUi.requestUpdate();
            }
            return;
        }

        if (apiKey == null || apiKey.length() == 0) {
            // Do not restart a pairing that is already running.
            //
            // View.onShow() calls this, and startPairing() clears _pairCode while
            // it requests a new one. The poll timer skips a null code, so every
            // re-show issued a fresh code and blanked it again before the 5s timer
            // could fire — the server handed out eleven codes in one run and the
            // watch never polled any of them. Pairing could not complete.
            if (_status.equals("pairing") && _pairCode != null && !isPairCodeExpired()) {
                return;
            }
            // Also hold off while a code request is still in flight. The guard
            // above only covers the window after a code arrives; a re-show
            // between the POST and its response would fire a second request,
            // which is why the server still saw pairs of /api/pair calls.
            if (_status.equals("pairing_request")) {
                return;
            }
            startPairing(serverUrl);
            return;
        }

        var url = serverUrl as String;
        while (url.length() > 0 && url.substring(url.length() - 1, url.length()).equals("/")) {
            url = url.substring(0, url.length() - 1);
        }

        var watchPath = "/api/watch";
        if (url.length() >= watchPath.length()) {
            var tail = url.substring(url.length() - watchPath.length(), url.length());
            if (!tail.equals(watchPath)) {
                url = url + watchPath;
            }
        } else {
            url = url + watchPath;
        }

        setStatus("loading");
        WatchUi.requestUpdate();
        startFetchTimer();

        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + apiKey,
                "ngrok-skip-browser-warning" => SKIP_INTERSTITIAL
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        logd("summary GET " + url);
        Communications.makeWebRequest(url, {}, options, method(:onSummaryReceived));
    }

    function onSummaryReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        stopFetchTimer();
        logd("summary cb rc=" + responseCode.toString()
            + " keys=" + (data != null && data instanceof Dictionary
                ? (data as Dictionary).keys().toString()
                : "none"));

        if (responseCode == 200 && data != null && data instanceof Dictionary) {
            var summary = data as Dictionary;
            setSummary(summary);
            persistSummary(summary);
            var updatedAt = summary.get("updated_at");
            setUpdatedAt(updatedAt != null ? updatedAt as String : null);
            setStatus("ready");
        } else if (!loadCachedSummary()) {
            setSummary(null);
            setUpdatedAt(null);
            setStatus("error");
        }

        WatchUi.requestUpdate();
    }

    // -------------------------------------------------------------------------
    // Pairing flow
    // -------------------------------------------------------------------------

    private function logd(message as String) as Void {
        if (DEBUG_LOG) {
            System.println("[tb] " + message);
        }
    }

    /** True when there is no live pairing code to poll for. */
    private function isPairCodeExpired() as Boolean {
        if (_pairExpiresAt == null) { return true; }
        return Time.now().value() >= (_pairExpiresAt as Number);
    }

    function startPairing(serverUrl as String) as Void {
        // Stop any poll still running for the code we are about to discard.
        stopPairTimer();
        _pairCode = null;
        _pairExpiresAt = null;
        setStatus("pairing_request");
        WatchUi.requestUpdate();

        // Diagnostic query string. The server logs the full path, so the app's
        // internal state shows up in the server log without anyone having to read
        // it off the watch face. Harmless to the endpoint, which ignores the query.
        _pairRequestCount += 1;
        var url = buildBaseUrl(serverUrl) + "/api/pair"
            + "?build=" + BUILD_ID
            + "&n=" + _pairRequestCount.toString()
            + "&polls=" + _pairPollCount.toString()
            + "&lastpoll=" + (_pairPollCode == null ? "none" : (_pairPollCode as Number).toString())
            + "&from=" + _status;
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_POST,
            // Only Content-Type, and only via the REQUEST_CONTENT_TYPE_* constant.
            //
            // Connect IQ validates request headers on the device and refuses the
            // whole request with responseCode -200
            // (INVALID_HTTP_HEADER_FIELDS_IN_REQUEST) and null data if it does not
            // like one — nothing is sent, so the server sees no traffic at all and
            // the failure is indistinguishable from an empty response. Two things
            // here caused that: a literal "application/json" instead of the
            // constant, and an "Accept" header, which the system manages itself and
            // does not accept from the app. Keep this dictionary minimal.
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(url, {}, options, method(:onPairCodeReceived));
    }

    function onPairCodeReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        logd("pair cb rc=" + responseCode.toString()
            + " data=" + (data == null ? "null" : data.toString()));
        if (responseCode == 200 && data != null && data instanceof Dictionary) {
            var d = data as Dictionary;
            var code = d.get("code");
            var expiresIn = d.get("expires_in");
            if (code != null && code instanceof String) {
                _pairCode = code as String;
                _pairExpiresAt = expiresIn != null
                    ? Time.now().value() + (expiresIn as Number)
                    : Time.now().value() + 300;
                setStatus("pairing");
                WatchUi.requestUpdate();
                startPairPolling();
                return;
            }
        }
        _pairErrorCode = responseCode;
        _pairFailClass = classifyPairFailure(responseCode);

        if (data == null) {
            _pairErrorBody = "<null body>";
        } else {
            var text = data.toString();
            _pairErrorBody = text.length() > 90 ? text.substring(0, 90) : text;
        }

        setStatus("pairing_error");
        WatchUi.requestUpdate();
    }

    // Which of the three failure screens to draw.
    //
    // A negative code is a Connect IQ constant, not an HTTP status, and always
    // means the request never completed: no phone, no HTTPS, a refused header,
    // a body that did not parse. Read the sign first.
    //
    // A 404 is the interesting one, and it is what the Forerunner 55 report was:
    // ngrok answers a request for a tunnel that is no longer running with a 404
    // and an HTML error page. So does any web server that is not TrainBud. The
    // user needs to hear "that address is not a TrainBud server", not "pairing
    // failed" -- the address is the thing they can fix.
    private function classifyPairFailure(responseCode as Number) as Number {
        if (responseCode < 0) {
            // These four all mean bytes came back and were not ours: HTML where
            // JSON was asked for, a content type we cannot read, headers we
            // cannot read, a body too big to hold. A tunnel interstitial, a
            // captive portal and a plain error page all land here.
            if (responseCode == Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE
                || responseCode == Communications.INVALID_HTTP_HEADER_FIELDS_IN_NETWORK_RESPONSE
                || responseCode == Communications.NETWORK_RESPONSE_TOO_LARGE
                || responseCode == Communications.UNSUPPORTED_CONTENT_TYPE_IN_RESPONSE) {
                return PairFail.NOT_SERVER;
            }
            // Everything else negative is the request never completing: no
            // phone, no HTTPS, a header refused on the device, a timeout.
            return PairFail.UNREACHABLE;
        }
        if (responseCode == 429) { return PairFail.REFUSED; }
        if (responseCode >= 500) { return PairFail.UNREACHABLE; }
        // Anything else in the 2xx-4xx range came from a host that answered but
        // does not serve POST /api/pair the way TrainBud does.
        return PairFail.NOT_SERVER;
    }

    function getPairErrorCode() as Number or Null { return _pairErrorCode; }
    function getPairFailClass() as Number          { return _pairFailClass; }

    /** True in a debug build. Gates on-screen diagnostics that mean nothing to
        a user but were worth a day of investigation to whoever is debugging. */
    function isDebugBuild() as Boolean { return DEBUG_LOG; }
    function getPairPollCount() as Number          { return _pairPollCount; }
    function getPairPollAttempts() as Number       { return _pairPollAttempts; }
    function getPairPollCode()  as Number or Null  { return _pairPollCode; }
    function getPairErrorBody() as String or Null { return _pairErrorBody; }

    private function stopPairTimer() as Void {
        if (_pairTimer != null) {
            _pairTimer.stop();
            _pairTimer = null;
        }
    }

    private function startPairPolling() as Void {
        logd("startPairPolling code=" + (_pairCode == null ? "null" : _pairCode as String));
        stopPairTimer();
        _pairTimer = new Timer.Timer();
        _pairTimer.start(method(:pollPairStatus), PAIR_POLL_MS, true);

        // Poll once immediately rather than waiting for the first timer tick.
        // Telemetry showed polls=0 forever: the code appeared on screen, so this
        // function ran, but the timer callback never fired even once. A direct
        // call separates "the timer is broken" from "the request is rejected",
        // and it also means an already-approved code is picked up at once
        // instead of after a five second wait.
        pollPairStatus();
    }

    function pollPairStatus() as Void {
        _pairPollAttempts += 1;
        logd("pollPairStatus enter attempt=" + _pairPollAttempts.toString()
            + " code=" + (_pairCode == null ? "null" : _pairCode as String));
        if (_pairCode == null) { logd("poll abort: no code"); return; }
        var serverUrl = getServerUrl();
        if (serverUrl == null) { logd("poll abort: no server url"); return; }

        // No :headers at all. This carried an empty dictionary, which Connect IQ
        // treats as invalid header fields and rejects on the device — the poll
        // never left the watch, and onPairStatusReceived has no error path, so
        // pairing sat on the code screen forever with nothing to show for it.
        var url = buildBaseUrl(serverUrl) + "/api/pair/" + (_pairCode as String) + "/status";
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_GET,
            // Bypasses the ngrok free-tier interstitial. Without it ngrok answers
            // any GET carrying a browser-ish User-Agent -- and Connect IQ sends
            // "Mozilla/5.0", which cannot be overridden -- with an HTML warning
            // page under a 200, and the request never reaches the server at all.
            // The watch then reports -400 INVALID_HTTP_BODY_IN_NETWORK_RESPONSE,
            // because HTML is not the JSON it asked for. POSTs are not
            // intercepted, which is exactly why /api/pair worked and every
            // status poll died. Harmless against any other host.
            :headers => {
                "ngrok-skip-browser-warning" => SKIP_INTERSTITIAL
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        // Parameters, not null. Every request in this file that has been observed
        // reaching the server passes a dictionary; every one that vanished passed
        // null. On a GET, Connect IQ encodes these into the query string, so this
        // doubles as telemetry: the server log now shows which binary polled and
        // how many attempts it had made by then.
        var params = {
            "build"    => BUILD_ID,
            "attempts" => _pairPollAttempts.toString(),
            "replies"  => _pairPollCount.toString()
        };
        logd("poll GET " + url);
        Communications.makeWebRequest(url, params, options, method(:onPairStatusReceived));
    }

    function onPairStatusReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        // Record every outcome. This returned silently on all failure paths, so a
        // poll that was rejected on the device looked identical to one that had
        // simply not been approved yet — the pairing screen just sat there.
        _pairPollCount += 1;
        _pairPollCode = responseCode;
        logd("poll cb rc=" + responseCode.toString()
            + " data=" + (data == null ? "null" : data.toString()));
        WatchUi.requestUpdate();

        if (responseCode != 200 || data == null || !(data instanceof Dictionary)) {
            return;
        }
        var d = data as Dictionary;
        var approved = d.get("approved");
        if (approved == null || !(approved instanceof Boolean) || !(approved as Boolean)) {
            return;
        }

        stopPairTimer();

        var apiKey    = d.get("api_key");
        var serverUrl = d.get("server_url");

        if (apiKey != null && apiKey instanceof String && serverUrl != null && serverUrl instanceof String) {
            saveCredentials(apiKey as String, serverUrl as String);
        } else if (apiKey != null && apiKey instanceof String) {
            var sv = getServerUrl();
            if (sv != null) {
                saveCredentials(apiKey as String, sv);
            }
        }

        setStatus("idle");
        fetchSummary();
    }

    // -------------------------------------------------------------------------
    // Prompt flow
    // -------------------------------------------------------------------------

    // The prompts the server generated from today's findings, if it sent any.
    //
    // Returns null rather than an empty array so callers fall back cleanly:
    // a watch talking to an older server, or one rendering a cached summary
    // from before this field existed, still gets the built-in five.
    private function getServerPrompts() as Array or Null {
        if (_summary == null) { return null; }

        var prompts = _summary.get("prompts");
        if (prompts == null || !(prompts instanceof Array)) { return null; }
        if ((prompts as Array).size() == 0) { return null; }

        return prompts as Array;
    }

    // How many entries the Ask menu has. The server sends five, but reading the
    // length rather than assuming it means a short list cannot walk off the end
    // of the array.
    function getPromptCount() as Number {
        var prompts = getServerPrompts();
        if (prompts == null) { return PROMPT_COUNT; }

        var size = prompts.size();
        return size < PROMPT_COUNT ? size : PROMPT_COUNT;
    }

    function getPromptText(index as Number) as String {
        var prompts = getServerPrompts();
        if (prompts != null && index >= 0 && index < prompts.size()) {
            var text = prompts[index];
            if (text instanceof String) { return text as String; }
        }

        // The built-in five. They read the same on an app with no memory at
        // all, which is exactly why the server generates better ones -- but
        // they are the right thing to show when it has not.
        if (index == 0) { return WatchUi.loadResource(Rez.Strings.AskPrompt1) as String; }
        if (index == 1) { return WatchUi.loadResource(Rez.Strings.AskPrompt2) as String; }
        if (index == 2) { return WatchUi.loadResource(Rez.Strings.AskPrompt3) as String; }
        if (index == 3) { return WatchUi.loadResource(Rez.Strings.AskPrompt4) as String; }
        return WatchUi.loadResource(Rez.Strings.AskPrompt5) as String;
    }

    function submitSelectedPrompt() as Void {
        var serverUrl = getServerUrl();
        var apiKey    = getApiKey();
        if (serverUrl == null || apiKey == null) { return; }

        var prompt = getPromptText(_askMenuIndex);
        _promptJobId    = null;
        _promptResult   = null;
        _promptError    = null;
        _promptStatus   = "submitting";
        _promptPageIndex = 0;
        _promptPageCount = 0;
        WatchUi.requestUpdate();

        var url = buildBaseUrl(serverUrl) + "/api/prompt";
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Authorization" => "Bearer " + apiKey,
                "Content-Type"  => Communications.REQUEST_CONTENT_TYPE_JSON,
                "ngrok-skip-browser-warning" => SKIP_INTERSTITIAL
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(url, { "prompt" => prompt }, options, method(:onPromptSubmitted));
    }

    function onPromptSubmitted(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode == 202 && data != null && data instanceof Dictionary) {
            var d = data as Dictionary;
            var jobId = d.get("job_id");
            if (jobId != null && jobId instanceof String) {
                _promptJobId  = jobId as String;
                _promptStatus = "waiting";
                WatchUi.requestUpdate();
                startPromptPolling();
                return;
            }
        }
        _promptStatus = "error";
        _promptError = "HTTP " + responseCode.toString();
        WatchUi.requestUpdate();
    }

    private function stopPromptTimers() as Void {
        if (_promptTimer != null) {
            _promptTimer.stop();
            _promptTimer = null;
        }
        if (_promptTimeoutTimer != null) {
            _promptTimeoutTimer.stop();
            _promptTimeoutTimer = null;
        }
    }

    private function startPromptPolling() as Void {
        stopPromptTimers();
        _promptTimer = new Timer.Timer();
        _promptTimer.start(method(:pollPromptStatus), PROMPT_POLL_MS, true);
        _promptTimeoutTimer = new Timer.Timer();
        _promptTimeoutTimer.start(method(:onPromptTimeout), PROMPT_TIMEOUT_MS, false);
    }

    function onPromptTimeout() as Void {
        stopPromptTimers();
        if (!_promptStatus.equals("done")) {
            _promptStatus = "error";
            _promptError = "Timed out";
            WatchUi.requestUpdate();
        }
    }

    function pollPromptStatus() as Void {
        if (_promptJobId == null) { return; }
        var serverUrl = getServerUrl();
        var apiKey    = getApiKey();
        if (serverUrl == null || apiKey == null) { return; }

        var url = buildBaseUrl(serverUrl) + "/api/prompt/" + (_promptJobId as String);
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {
                "Authorization" => "Bearer " + apiKey,
                "ngrok-skip-browser-warning" => SKIP_INTERSTITIAL
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        logd("prompt status GET " + url);
        Communications.makeWebRequest(url, {}, options, method(:onPromptStatusReceived));
    }

    function onPromptStatusReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        if (responseCode != 200 || data == null || !(data instanceof Dictionary)) { return; }
        var d = data as Dictionary;
        var status = d.get("status");
        if (status == null || !(status instanceof String)) { return; }
        var s = status as String;

        if (s.equals("done")) {
            stopPromptTimers();
            var result = d.get("result");
            _promptResult = result != null && result instanceof String ? result as String : "";
            _promptStatus = "done";
            _promptPageIndex = 0;
            _promptPageCount = computePageCount(_promptResult as String);
            WatchUi.requestUpdate();
        } else if (s.equals("error")) {
            stopPromptTimers();
            // Carry the server's reason to the screen. It is the difference
            // between "no API key" and "the provider refused", and the user
            // can act on the first.
            var reason = d.get("error");
            _promptError = reason != null && reason instanceof String
                ? reason as String
                : null;
            _promptStatus = "error";
            WatchUi.requestUpdate();
        }
    }

    function clearPrompt() as Void {
        stopPromptTimers();
        _promptJobId  = null;
        _promptResult = null;
        _promptError  = null;
        _promptStatus = "idle";
        _promptPageIndex = 0;
        _promptPageCount = 0;
    }

    private function computePageCount(text as String) as Number {
        // ~80 chars per page on small watch screen
        var pageSize = 80;
        if (text.length() == 0) { return 1; }
        return ((text.length() + pageSize - 1) / pageSize).toNumber();
    }

    function getPromptPage(pageIndex as Number) as String {
        if (_promptResult == null) { return ""; }
        var text = _promptResult as String;
        var pageSize = 80;
        var start = pageIndex * pageSize;
        var end = start + pageSize;
        if (start >= text.length()) { return ""; }
        if (end > text.length()) { end = text.length(); }
        return text.substring(start, end);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function buildBaseUrl(serverUrl as String) as String {
        var url = serverUrl;
        while (url.length() > 0 && url.substring(url.length() - 1, url.length()).equals("/")) {
            url = url.substring(0, url.length() - 1);
        }
        return url;
    }
}
