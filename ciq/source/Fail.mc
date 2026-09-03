import Toybox.Communications;
import Toybox.Lang;

//
// Why a request failed, in the terms the user can act on.
//
// This started life as `PairFail` on the pairing flow alone, because pairing
// was the flow that had burned a day: one screen reading "Pairing failed. Tap
// to retry." stood for a watch with no phone, a mistyped URL, a dead tunnel
// answering an HTML 404, a captive portal answering 200, and a healthy server
// that said no. Four different actions, none of them named.
//
// The same fault then appeared twice more, because the classification lived on
// the pairing flow instead of on the request layer:
//
//   * the summary fetch drew "Could not reach TrainBud" for every failure,
//     including a 401 from a rotated API key, where the fix is to re-pair and
//     "could not reach" is simply false;
//   * the prompt submit drew "AI unavailable" plus the raw code, so a dead
//     tunnel returning -400 was reported to the user as a broken AI. That is
//     the bug this module exists to make unrepresentable: the Ask card cannot
//     blame the AI for a request that never reached the server.
//
// One classifier, three call sites. A new request path gets the taxonomy for
// free and cannot invent a fifth vocabulary.
//
// Read the sign of the code first: a NEGATIVE responseCode is a Connect IQ
// constant, not an HTTP status. -200 is not "HTTP 200". Misreading that sign
// once cost most of 2026-08-17.
//
module Fail {
    const NONE         = -1;  // no failure recorded
    const UNREACHABLE  = 0;   // nothing answered: transport error, or 5xx
    const NOT_SERVER   = 1;   // something answered, but it is not us
    const REFUSED      = 2;   // our server answered and declined
    const UNAUTHORIZED = 3;   // our server answered and does not know this key
    // Pairing only: the code on screen is dead. Not a transport failure -- the
    // request succeeded and the answer was "there is no such code" -- but it
    // needs its own screen, because the action is "get a new code" and every
    // other class here says something the user cannot act on.
    const EXPIRED      = 4;

    //
    // Which class a response code falls into.
    //
    // A 404 is the interesting one, and it is what the Forerunner 55 report
    // was: ngrok answers a request for a tunnel that is no longer running with
    // a 404 and an HTML error page, and so does any web server that is not
    // TrainBud. The user needs to hear "that address is not a TrainBud server",
    // because the address is the thing they can fix.
    //
    function classify(responseCode as Number) as Number {
        if (responseCode < 0) {
            // These four all mean bytes came back and were not ours: HTML where
            // JSON was asked for, a content type we cannot read, headers we
            // cannot read, a body too big to hold. A tunnel interstitial, a
            // captive portal and a plain error page all land here.
            if (responseCode == Communications.INVALID_HTTP_BODY_IN_NETWORK_RESPONSE
                || responseCode == Communications.INVALID_HTTP_HEADER_FIELDS_IN_NETWORK_RESPONSE
                || responseCode == Communications.NETWORK_RESPONSE_TOO_LARGE
                || responseCode == Communications.UNSUPPORTED_CONTENT_TYPE_IN_RESPONSE) {
                return NOT_SERVER;
            }
            // Everything else negative is the request never completing: no
            // phone, no HTTPS, a header refused on the device, a timeout.
            return UNREACHABLE;
        }

        // 401/403 is a server that answered and knows what we asked for --
        // it just will not do it for this credential. Every one of these
        // previously rendered as "cannot reach", which is the one thing that
        // is definitely not true when a 401 comes back. The API key can be
        // rotated on the server at any time, and pairing again is the fix.
        if (responseCode == 401 || responseCode == 403) { return UNAUTHORIZED; }
        if (responseCode == 429) { return REFUSED; }
        if (responseCode >= 500) { return UNREACHABLE; }

        // Anything else in the 2xx-4xx range came from a host that answered but
        // does not serve this endpoint the way TrainBud does.
        return NOT_SERVER;
    }

    /** True when retrying the identical request could plausibly succeed.
        A 401 will 401 again until the watch is paired afresh, and a host that
        is not TrainBud will not become TrainBud on the second attempt. */
    function isWorthRetrying(failClass as Number) as Boolean {
        return failClass == UNREACHABLE || failClass == REFUSED;
    }
}
