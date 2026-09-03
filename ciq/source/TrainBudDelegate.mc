import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class TrainBudDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    // -------------------------------------------------------------------------
    // Back / Menu
    // -------------------------------------------------------------------------

    function onBack() as Boolean {
        var app = Application.getApp() as TrainBudApp;
        var promptStatus = app.getPromptStatus();

        // Back from prompt result / error → return to Ask AI menu
        if (app.getCardIndex() == Cards.ASK_AI && !promptStatus.equals("idle")) {
            app.clearPrompt();
            WatchUi.requestUpdate();
            return true;
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Tap / Select — primary action
    // -------------------------------------------------------------------------

    function onTap(clickEvent as WatchUi.ClickEvent) as Boolean {
        handleSelect();
        return true;
    }

    function onSelect() as Boolean {
        handleSelect();
        return true;
    }

    private function handleSelect() as Void {
        var app    = Application.getApp() as TrainBudApp;

        // In a -Screens build every key is "next screen". The normal actions
        // would fire requests at a server that is not there and leave the tour
        // stuck on an error state of its own making.
        if (ScreenTour.isActive()) {
            ScreenTour.step(app, true);
            WatchUi.requestUpdate();
            return;
        }

        var status = app.getStatus();
        var cardIndex = app.getCardIndex();

        // Pairing screens
        if (status.equals("pairing_error") || status.equals("config")) {
            var serverUrl = app.getServerUrl();
            if (serverUrl != null) {
                app.startPairing(serverUrl);
            } else {
                app.fetchSummary();
            }
            return;
        }

        if (status.equals("error")) {
            app.fetchSummary();
            return;
        }

        // Ask AI card
        if (cardIndex == Cards.ASK_AI) {
            var promptStatus = app.getPromptStatus();

            if (promptStatus.equals("idle")) {
                // Submit selected prompt
                app.submitSelectedPrompt();
                return;
            }

            if (promptStatus.equals("error")) {
                app.clearPrompt();
                WatchUi.requestUpdate();
                return;
            }

            // Navigate through result pages
            if (promptStatus.equals("done")) {
                app.nextPromptPage();
                WatchUi.requestUpdate();
                return;
            }

            return;
        }

        // Normal cards — navigate forward
        if (status.equals("ready") || status.equals("stale")) {
            app.nextCard();
            WatchUi.requestUpdate();
        }
    }

    // -------------------------------------------------------------------------
    // Buttons
    //
    // BehaviorDelegate maps the DOWN and UP keys to these on every device, and
    // neither was implemented: on the five products in the manifest with no
    // touch screen -- fr55, fr745 and the three Instinct 3 variants -- the
    // carousel could only ever move forwards, one START press at a time, and
    // the Ask menu could not be scrolled at all. Everything below mirrors
    // onSwipe: DOWN behaves as a left swipe, UP as a right swipe.
    // -------------------------------------------------------------------------

    function onNextPage() as Boolean {
        return step(true);
    }

    function onPreviousPage() as Boolean {
        return step(false);
    }

    private function step(forward as Boolean) as Boolean {
        var app = Application.getApp() as TrainBudApp;

        if (ScreenTour.isActive()) {
            ScreenTour.step(app, forward);
            WatchUi.requestUpdate();
            return true;
        }

        if (app.getCardIndex() == Cards.ASK_AI) {
            var promptStatus = app.getPromptStatus();

            if (promptStatus.equals("idle")) {
                // Past the last prompt, leave the card forwards.
                //
                // The menu used to wrap, and going back from the first item
                // left the card while going forward from the last did not, so
                // the carousel dead-ended here: Ask is card 1, and the six
                // metric cards after it could only be reached by paging
                // backwards from Today. Leaving at both ends makes the loop
                // traversable in either direction.
                if (forward) {
                    if (app.getAskMenuIndex() < app.getPromptCount() - 1) {
                        app.nextAskMenuItem();
                    } else {
                        app.nextCard();
                    }
                } else if (app.getAskMenuIndex() > 0) {
                    app.prevAskMenuItem();
                } else {
                    app.prevCard();
                }
                WatchUi.requestUpdate();
                return true;
            }

            if (promptStatus.equals("done")) {
                if (forward) {
                    app.nextPromptPage();
                } else if (app.getPromptPageIndex() > 0) {
                    app.prevPromptPage();
                } else {
                    app.clearPrompt();
                }
                WatchUi.requestUpdate();
                return true;
            }

            return true;
        }

        var status = app.getStatus();
        if (status.equals("ready") || status.equals("stale")) {
            if (forward) { app.nextCard(); } else { app.prevCard(); }
            WatchUi.requestUpdate();
            return true;
        }

        // Not on a card yet: a page press on an error or setup screen is a
        // retry, the same as a tap. Without this the only way off those screens
        // on a button watch was START, which is not what a stuck user presses.
        if (status.equals("error") || status.equals("config")
            || status.equals("pairing_error")) {
            handleSelect();
            return true;
        }

        return false;
    }

    // -------------------------------------------------------------------------
    // Swipe
    // -------------------------------------------------------------------------

    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Boolean {
        var app       = Application.getApp() as TrainBudApp;
        var direction = swipeEvent.getDirection();

        if (ScreenTour.isActive()) {
            ScreenTour.step(app,
                direction == WatchUi.SWIPE_LEFT || direction == WatchUi.SWIPE_UP);
            WatchUi.requestUpdate();
            return true;
        }

        var cardIndex = app.getCardIndex();
        var promptStatus = app.getPromptStatus();

        // Ask AI card
        if (cardIndex == Cards.ASK_AI) {
            if (promptStatus.equals("idle")) {
                // Swipe up/down or left/right moves through the prompts, and
                // off the card at either end -- see the note in step().
                if (direction == WatchUi.SWIPE_UP || direction == WatchUi.SWIPE_LEFT) {
                    if (app.getAskMenuIndex() < app.getPromptCount() - 1) {
                        app.nextAskMenuItem();
                    } else {
                        app.nextCard();
                    }
                    WatchUi.requestUpdate();
                } else if (direction == WatchUi.SWIPE_DOWN || direction == WatchUi.SWIPE_RIGHT) {
                    if (app.getAskMenuIndex() > 0) {
                        app.prevAskMenuItem();
                        WatchUi.requestUpdate();
                    } else {
                        // Swipe right from first item → leave Ask AI card
                        app.prevCard();
                        WatchUi.requestUpdate();
                    }
                }
                return true;
            }

            if (promptStatus.equals("done")) {
                if (direction == WatchUi.SWIPE_LEFT) {
                    app.nextPromptPage();
                    WatchUi.requestUpdate();
                } else if (direction == WatchUi.SWIPE_RIGHT) {
                    if (app.getPromptPageIndex() > 0) {
                        app.prevPromptPage();
                        WatchUi.requestUpdate();
                    } else {
                        app.clearPrompt();
                        WatchUi.requestUpdate();
                    }
                }
                return true;
            }

            return true;
        }

        // Normal card navigation
        var status = app.getStatus();
        if (status.equals("ready") || status.equals("stale")) {
            if (direction == WatchUi.SWIPE_LEFT) {
                app.nextCard();
                WatchUi.requestUpdate();
            } else if (direction == WatchUi.SWIPE_RIGHT) {
                app.prevCard();
                WatchUi.requestUpdate();
            }
        } else if (status.equals("error") || status.equals("config")) {
            app.fetchSummary();
        }

        return true;
    }
}
