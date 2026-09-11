import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { audioFilename, transcriptionCostUsd, MAX_AUDIO_BYTES } from "../src/transcribe.js";

// The network half of transcription is one fetch and is not worth a mock. What
// is worth pinning is the two things that fail silently: the filename Groq
// picks its decoder from, and the cost that feeds the spending cap.

describe("audioFilename", () => {
  it("matches the extension to the container the phone actually recorded", () => {
    // Safari records mp4/aac, Chrome webm/opus. Posting one under the other's
    // extension fails inside the decoder with an error that says nothing about
    // the real cause.
    assert.equal(audioFilename("audio/webm"), "speech.webm");
    assert.equal(audioFilename("audio/mp4"), "speech.m4a");
    assert.equal(audioFilename("audio/ogg"), "speech.ogg");
    assert.equal(audioFilename("audio/wav"), "speech.wav");
    assert.equal(audioFilename("audio/mpeg"), "speech.mp3");
  });

  it("ignores codec parameters, which MediaRecorder always appends", () => {
    assert.equal(audioFilename("audio/webm;codecs=opus"), "speech.webm");
    assert.equal(audioFilename("audio/mp4; codecs=mp4a.40.2"), "speech.m4a");
  });

  it("is case insensitive, because headers are", () => {
    assert.equal(audioFilename("AUDIO/WEBM"), "speech.webm");
  });

  it("falls back to webm rather than throwing on something unrecognised", () => {
    // A wrong guess produces a decode error the user can read. An exception
    // here produces a 500 and no transcript at all.
    assert.equal(audioFilename("application/octet-stream"), "speech.webm");
    assert.equal(audioFilename(""), "speech.webm");
  });
});

describe("transcriptionCostUsd", () => {
  it("prices an hour at the published rate", () => {
    const hour = transcriptionCostUsd(3600);
    assert.ok(hour !== null);
    assert.ok(Math.abs((hour as number) - 0.04) < 1e-9);
  });

  it("makes a spoken question cost a fraction of a cent", () => {
    const tenSeconds = transcriptionCostUsd(10) as number;
    assert.ok(tenSeconds > 0, "a real call must not be free");
    assert.ok(tenSeconds < 0.0002, `ten seconds cost ${tenSeconds}`);
  });

  it("reports an unknown duration as unpriced, never as zero", () => {
    // A call recorded at zero cost makes a spending cap that can never trip,
    // which is the same trap the model price table already avoids.
    assert.equal(transcriptionCostUsd(null), null);
    assert.equal(transcriptionCostUsd(Number.NaN), null);
    assert.equal(transcriptionCostUsd(-5), null);
  });

  it("prices zero-length audio at zero, which is not the same as unknown", () => {
    assert.equal(transcriptionCostUsd(0), 0);
  });
});

describe("the audio size cap", () => {
  it("is large enough for a real question and small enough to bound a stuck button", () => {
    // Opus at ~24 kbps puts a minute of speech near 180 KB, so 8 MB is minutes
    // of headroom while still refusing a runaway recording outright.
    assert.ok(MAX_AUDIO_BYTES >= 1024 * 1024);
    assert.ok(MAX_AUDIO_BYTES <= 25 * 1024 * 1024);
  });
});
