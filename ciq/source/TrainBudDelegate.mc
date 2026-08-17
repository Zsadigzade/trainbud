import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class GarminBudDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    // -------------------------------------------------------------------------
    // Back / Menu
    // -------------------------------------------------------------------------

    function onBack() as Boolean {
        var app = Application.getApp() as GarminBudApp;
        var promptStatus = app.getPromptStatus();

        // Back from prompt result / error → return to Ask AI menu
        if (app.getCardIndex() == 8 && !promptStatus.equals("idle")) {
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
        var app    = Application.getApp() as GarminBudApp;
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

        // Ask AI card (card 8)
        if (cardIndex == 8) {
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
    // Swipe
    // -------------------------------------------------------------------------

    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Boolean {
        var app       = Application.getApp() as GarminBudApp;
        var direction = swipeEvent.getDirection();
        var cardIndex = app.getCardIndex();
        var promptStatus = app.getPromptStatus();

        // Ask AI card (card 8)
        if (cardIndex == 8) {
            if (promptStatus.equals("idle")) {
                // Swipe up/down or left/right cycles through prompts
                if (direction == WatchUi.SWIPE_UP || direction == WatchUi.SWIPE_LEFT) {
                    app.nextAskMenuItem();
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
