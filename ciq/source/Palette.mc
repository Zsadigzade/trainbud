import Toybox.Graphics;
import Toybox.Lang;

//
// The colours, in one place, chosen to survive the worst screen in the manifest.
//
// THE FORERUNNER 55 HAS AN EIGHT-COLOUR PALETTE: black, blue, green, cyan, red,
// magenta, yellow, white. Connect IQ snaps every colour to the nearest entry,
// so a colour is not what you wrote -- it is whatever that device rounds it to,
// and you will never see the difference in the simulator unless you run it on
// that device. This app has already lost four UI elements that way:
// COLOR_DK_GRAY rounds to BLACK, on a black background.
//
// Two rules follow, and both are load-bearing.
//
// COLOUR ENCODES STATE AND NOTHING ELSE. It is never brand, never decoration,
// never a heading. Hierarchy comes from font size and position, which every
// device renders identically. That is also why there is no accent colour here:
// the brand amber would be the same amber as `CAUTION`, and a user who has
// learned that amber means "look at this" must not meet it as a page dot.
//
// EVERY VALUE IS CHECKED AGAINST THE ROUNDING. GOOD used to be the mint
// #3DDC84 that the dashboard shipped with; on the Forerunner 55 that rounds to
// CYAN -- a colour with no meaning in this system -- so it moved to #4CD964,
// which rounds to green. CAUTION #F5A623 rounds to yellow and HARD #E5484D
// rounds to red, both correctly. SECONDARY #8FA3BD rounds to white, which is
// why it is safe as "dimmer text" on a device with no grey at all.
//
module Palette {

    const BG        = 0x000000;
    const PRIMARY   = 0xFFFFFF;

    // Secondary text and the track behind a value. Rounds to white on the
    // eight-colour devices, which is readable; the hierarchy against PRIMARY is
    // carried by the font, not by the colour.
    const SECONDARY = 0x8FA3BD;

    const GOOD      = 0x4CD964;
    const CAUTION   = 0xF5A623;
    const HARD      = 0xE5484D;

    // A value the server did not grade. Deliberately the same as PRIMARY: an
    // unworn watch is not a bad score, and a number the app cannot judge must
    // not be tinted as though it had been judged.
    const UNGRADED  = 0xFFFFFF;

    //
    // The colour for one of the four states the server sends.
    //
    // The watch no longer knows where any threshold falls. It used to carry its
    // own copies -- recoveryColor, sleepColor, stressColor, heartRateColor --
    // which meant the wrist and the dashboard could disagree about the same
    // score, and made per-user thresholds impossible without shipping the bands
    // to the device and implementing the comparison twice.
    //
    function forState(state) as Number {
        if (state == null || !(state instanceof String)) { return UNGRADED; }
        var name = state as String;
        if (name.equals("good"))    { return GOOD; }
        if (name.equals("caution")) { return CAUTION; }
        if (name.equals("hard"))    { return HARD; }
        return UNGRADED;
    }
}
