import Toybox.Application;
import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

class GarminBudApp extends Application.AppBase {

    // Storage keys
    const STORAGE_SUMMARY_KEY    = "summary";
    const STORAGE_UPDATED_AT_KEY = "updated_at";
    const STORAGE_CACHED_AT_KEY  = "cached_at";
    const STORAGE_API_KEY        = "api_key";
    const STORAGE_SERVER_URL     = "server_url";

    // Card count: Overview, Recovery, Sleep, Activity, Stress, VO2Max, HeartRate, AI Insight, Ask AI
    const CARD_COUNT = 9;

    const FETCH_TIMEOUT_MS  = 10000;
    const PAIR_POLL_MS      = 5000;
    const PROMPT_POLL_MS    = 3000;
    const PROMPT_TIMEOUT_MS = 30000;

    // Preset prompts (must match AskPrompt* strings)
    const PROMPT_COUNT = 5;

    private var _summary    as Dictionary or Null = null;
    private var _status     as String = "idle";
    private var _cardIndex  as Number = 0;
    private var _updatedAt  as String or Null = null;
    private var _cachedAt   as Number or Null = null;

    // Pairing state
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
        return [ new GarminBudView(), new GarminBudDelegate() ];
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
    function getPromptResult()    as String or Null     { return _promptResult; }
    function getPromptPageIndex() as Number             { return _promptPageIndex; }
    function getPromptPageCount() as Number             { return _promptPageCount; }
    function getAskMenuIndex()    as Number             { return _askMenuIndex; }

    function setStatus(status as String) as Void  { _status = status; }
    function setSummary(data as Dictionary or Null) as Void { _summary = data; }
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
        _askMenuIndex = (_askMenuIndex + 1) % PROMPT_COUNT;
    }

    function prevAskMenuItem() as Void {
        _askMenuIndex = (_askMenuIndex + PROMPT_COUNT - 1) % PROMPT_COUNT;
    }

    // -------------------------------------------------------------------------
    // Stored credentials
    // -------------------------------------------------------------------------

    function getServerUrl() as String or Null {
        var stored = Storage.getValue(STORAGE_SERVER_URL);
        if (stored != null && stored instanceof String) {
            return stored as String;
        }
        var prop = Properties.getValue("ServerUrl");
        if (prop != null && prop instanceof String) {
            return prop as String;
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
            // Need to pair
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
                "Accept"        => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(url, null, options, method(:onSummaryReceived));
    }

    function onSummaryReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
        stopFetchTimer();

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

    function startPairing(serverUrl as String) as Void {
        _pairCode = null;
        _pairExpiresAt = null;
        setStatus("pairing_request");
        WatchUi.requestUpdate();

        var url = buildBaseUrl(serverUrl) + "/api/pair";
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => { "Content-Type" => "application/json", "Accept" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };

        Communications.makeWebRequest(url, {}, options, method(:onPairCodeReceived));
    }

    function onPairCodeReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
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
        setStatus("pairing_error");
        WatchUi.requestUpdate();
    }

    private function stopPairTimer() as Void {
        if (_pairTimer != null) {
            _pairTimer.stop();
            _pairTimer = null;
        }
    }

    private function startPairPolling() as Void {
        stopPairTimer();
        _pairTimer = new Timer.Timer();
        _pairTimer.start(method(:pollPairStatus), PAIR_POLL_MS, true);
    }

    function pollPairStatus() as Void {
        if (_pairCode == null) { return; }
        var serverUrl = getServerUrl();
        if (serverUrl == null) { return; }

        var url = buildBaseUrl(serverUrl) + "/api/pair/" + (_pairCode as String) + "/status";
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => { "Accept" => Communications.REQUEST_CONTENT_TYPE_JSON },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(url, null, options, method(:onPairStatusReceived));
    }

    function onPairStatusReceived(responseCode as Number, data as Dictionary or String or Null) as Void {
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

    function getPromptText(index as Number) as String {
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
        _promptStatus   = "submitting";
        _promptPageIndex = 0;
        _promptPageCount = 0;
        WatchUi.requestUpdate();

        var url = buildBaseUrl(serverUrl) + "/api/prompt";
        var options = {
            :method  => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Authorization" => "Bearer " + apiKey,
                "Content-Type"  => "application/json",
                "Accept"        => Communications.REQUEST_CONTENT_TYPE_JSON
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
                "Accept"        => Communications.REQUEST_CONTENT_TYPE_JSON
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
        };
        Communications.makeWebRequest(url, null, options, method(:onPromptStatusReceived));
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
            _promptStatus = "error";
            WatchUi.requestUpdate();
        }
    }

    function clearPrompt() as Void {
        stopPromptTimers();
        _promptJobId  = null;
        _promptResult = null;
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
