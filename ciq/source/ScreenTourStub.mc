import Toybox.Lang;

//
// The screen tour, absent.
//
// This is what ships. The real driver lives in ciq/source-screens and is only
// on the source path for a `-Screens` build, where monkey-screens.jungle
// excludes this stub by its annotation. Excluding annotations is additive in a
// jungle -- a later jungle can add exclusions and can never remove one -- so
// the stub has to be the one that carries the annotation and the real
// implementation the one that is simply absent from the default source path.
//
// Cost in the store build: three functions that always answer "no tour".
//
(:screensStub)
module ScreenTour {

    /** False in every build a user can install. */
    function isActive() as Boolean { return false; }

    function count() as Number { return 0; }

    function index() as Number { return 0; }

    function label(i as Number) as String { return ""; }

    function apply(app as TrainBudApp, i as Number) as Void {}

    function enter(app as TrainBudApp) as Void {}

    function step(app as TrainBudApp, forward as Boolean) as Void {}
}
