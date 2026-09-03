import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDashboardStatus, renderDashboard } from "../src/dashboard.js";

/**
 * The dashboard prints the server URL the user is told to type into Connect IQ
 * settings, and it read that URL from `.trainbud/watch-setup.json` -- a file
 * written when a tunnel starts and never corrected when that tunnel dies. The
 * pairing flow was fixed to derive the host from the request that actually
 * arrived; the page that tells the user what to type was still reading the file,
 * so it kept handing out an address that had been dead for weeks.
 */
describe("the dashboard must report the URL it was actually reached on", () => {
  it("prefers the live request URL over whatever the setup file holds", () => {
    const status = getDashboardStatus("https://live-tunnel.ngrok-free.dev");
    assert.equal(status.public_url, "https://live-tunnel.ngrok-free.dev");
  });

  it("prints that URL in the panel the user copies from", () => {
    const html = renderDashboard("https://live-tunnel.ngrok-free.dev");
    assert.match(html, /https:\/\/live-tunnel\.ngrok-free\.dev/);
  });

  it("still falls back to the configured URL when there is no request to read", () => {
    const previous = process.env.TRAINBUD_PUBLIC_URL;
    process.env.TRAINBUD_PUBLIC_URL = "https://configured.example.com";
    try {
      assert.equal(getDashboardStatus().public_url, "https://configured.example.com");
    } finally {
      if (previous === undefined) {
        delete process.env.TRAINBUD_PUBLIC_URL;
      } else {
        process.env.TRAINBUD_PUBLIC_URL = previous;
      }
    }
  });
});
