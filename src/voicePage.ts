// SECTION: The voice page
//
// A phone-first page at /voice: hold a button, ask a question out loud, hear
// the answer. It reuses the dashboard's session cookie and the existing
// POST /api/prompt job queue, so there is no new auth and no new AI path --
// only a different way of putting a sentence into the one that exists.
//
// WHY THIS IS A PAGE AND NOT A WATCH FEATURE
//
// Connect IQ exposes no microphone and no speaker to a widget, on any device,
// and it has no channel for the watch to trigger anything on the paired phone.
// So voice starts on the phone or it does not start. The watch's Ask card is
// untouched and stays a bounded preset menu.
//
// THE TWO PLATFORMS ARE GENUINELY DIFFERENT AND THE PAGE ADMITS IT
//
// Chrome on Android has the Web Speech API: recognition happens through the
// browser, free, with no key and no server round trip. iOS Safari's
// `webkitSpeechRecognition` is inconsistent across versions and fails silently,
// which is the worst possible behaviour for something held at arm's length
// while running -- so iOS records audio and posts it to /api/transcribe, which
// costs about a hundredth of a cent per question.
//
// Text to speech needs no such split: `speechSynthesis` works on both.
//
// THE LIMITATION, STATED ON THE PAGE ITSELF
//
// Mobile browsers suspend microphone access when the tab is backgrounded or the
// screen is off. The phone has to be awake with this page in front, per
// question. This is NOT screen-off, phone-in-pocket, earbuds-only operation,
// and no amount of work on this page changes that -- it would take a native app.
// Saying so on the page is cheaper than everyone discovering it mid-run.

export interface VoicePageOptions {
  /** Whether a server-side transcription key exists, which is what iOS needs. */
  transcriptionConfigured: boolean;
  /** Whether an AI key exists at all. Without one there is nothing to ask. */
  aiConfigured: boolean;
  /** The person's name, for the spoken summary. */
  name: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderVoicePage(options: VoicePageOptions): string {
  const { transcriptionConfigured, aiConfigured, name } = options;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>TrainBud — Voice</title>
<style>
  :root {
    --bg: #f6f6f4;
    --panel: #ffffff;
    --ink: #17171a;
    --muted: #6b6b73;
    --line: #e2e2de;
    --accent: #2f6f4f;
    --accent-ink: #ffffff;
    --warn: #8a5a00;
    --warn-bg: #fdf4e0;
    --live: #b23b2e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131315;
      --panel: #1c1c1f;
      --ink: #ececef;
      --muted: #9a9aa2;
      --line: #2c2c31;
      --accent: #4f9e77;
      --accent-ink: #0c1a13;
      --warn: #e0b567;
      --warn-bg: #2a2314;
      --live: #e0705f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px 16px 48px;
    background: var(--bg);
    color: var(--ink);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; margin: 0 0 20px; }
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .talk {
    display: flex; flex-direction: column; align-items: center; gap: 12px;
    padding: 24px 16px;
  }
  button {
    font: inherit;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--panel);
    color: var(--ink);
    padding: 11px 16px;
    cursor: pointer;
    min-height: 44px;
  }
  button:disabled { opacity: 0.45; cursor: not-allowed; }
  #talk {
    width: 168px; height: 168px; border-radius: 50%;
    background: var(--accent); color: var(--accent-ink);
    border: none; font-size: 17px; font-weight: 600;
    /* The mic must not fight a long-press text selection or a double-tap zoom;
       both make a push-to-talk button feel broken on a phone. */
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
    touch-action: manipulation;
  }
  #talk.listening { background: var(--live); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.045); } }
  @media (prefers-reduced-motion: reduce) { #talk.listening { animation: none; } }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .row button { flex: 1 1 46%; }
  .transcript { font-size: 18px; min-height: 1.5em; margin: 0; }
  .transcript.interim { color: var(--muted); }
  .answer { font-size: 17px; white-space: pre-wrap; margin: 0; }
  .muted { color: var(--muted); font-size: 13px; }
  .note {
    background: var(--warn-bg); color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 30%, transparent);
    border-radius: 10px; padding: 10px 12px; font-size: 13px; margin-bottom: 14px;
  }
  .hidden { display: none !important; }
  a { color: var(--accent); }
  footer { margin-top: 26px; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Ask TrainBud</h1>
  <p class="sub">Your data, out loud.${name ? ` Hello, ${escapeHtml(name)}.` : ""}</p>

  ${
    aiConfigured
      ? ""
      : `<div class="note"><strong>No AI key set.</strong> Questions cannot be answered until
         one is saved on the <a href="/dashboard">dashboard</a>. The spoken day summary below
         still works — it is computed in code, not generated.</div>`
  }

  <div id="ios-note" class="note hidden"></div>

  <div class="panel talk">
    <button id="talk" type="button" aria-describedby="hint">Hold to talk</button>
    <p id="hint" class="muted" style="text-align:center;margin:0">Hold the button, ask, let go.</p>
    <p id="transcript" class="transcript" aria-live="polite"></p>
  </div>

  <div class="panel">
    <div class="row">
      <button id="speak-day" type="button">Read me my day</button>
      <button id="speak-insight" type="button">Read today's insight</button>
    </div>
    <div class="row" style="margin-top:8px">
      <button id="stop-speaking" type="button" disabled>Stop speaking</button>
      <button id="repeat" type="button" disabled>Say that again</button>
    </div>
  </div>

  <div class="panel">
    <p class="muted" style="margin-top:0">Answer</p>
    <p id="answer" class="answer" aria-live="polite">—</p>
    <p id="cost" class="muted"></p>
  </div>

  <div class="panel">
    <p class="muted" style="margin-top:0">Or type it</p>
    <form id="typed" style="display:flex;gap:8px">
      <input id="typed-input" type="text" maxlength="500" placeholder="How did I sleep this week?"
             style="flex:1;min-width:0;padding:11px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit">
      <button type="submit">Ask</button>
    </form>
  </div>

  <footer>
    <p><strong>The phone has to be awake with this page in front.</strong> Mobile browsers
    suspend the microphone when the tab is in the background or the screen is off, so this is
    not hands-free, phone-in-pocket use. That would take a native app, not a change here.</p>
    <p><a href="/dashboard">Back to the dashboard</a></p>
  </footer>
</main>

<script>
(function () {
  "use strict";

  var talk = document.getElementById("talk");
  var hint = document.getElementById("hint");
  var transcriptEl = document.getElementById("transcript");
  var answerEl = document.getElementById("answer");
  var costEl = document.getElementById("cost");
  var iosNote = document.getElementById("ios-note");
  var stopBtn = document.getElementById("stop-speaking");
  var repeatBtn = document.getElementById("repeat");
  var lastSpoken = "";

  var TRANSCRIPTION_CONFIGURED = ${transcriptionConfigured ? "true" : "false"};

  // --- speech out ---------------------------------------------------------

  function speak(text) {
    if (!text) return;
    lastSpoken = text;
    repeatBtn.disabled = false;
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.02;
    utterance.onstart = function () { stopBtn.disabled = false; };
    utterance.onend = function () { stopBtn.disabled = true; };
    utterance.onerror = function () { stopBtn.disabled = true; };
    window.speechSynthesis.speak(utterance);
  }

  stopBtn.addEventListener("click", function () {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopBtn.disabled = true;
  });
  repeatBtn.addEventListener("click", function () { speak(lastSpoken); });

  // --- asking -------------------------------------------------------------

  function setAnswer(text, muted) {
    answerEl.textContent = text;
    answerEl.style.color = muted ? "var(--muted)" : "";
  }

  function ask(question) {
    if (!question) return;
    transcriptEl.textContent = question;
    transcriptEl.classList.remove("interim");
    setAnswer("Thinking…", true);
    costEl.textContent = "";

    fetch("/api/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: question })
    })
      .then(function (response) {
        if (!response.ok) return response.text().then(function (body) { throw new Error(body || response.status); });
        return response.json();
      })
      .then(function (job) { poll(job.job_id); })
      .catch(function (error) { setAnswer("Could not ask: " + error.message); });
  }

  function poll(id) {
    if (!id) { setAnswer("The server accepted the question but returned no job id."); return; }
    var attempts = 0;

    (function next() {
      attempts++;
      // ~60s. An answer that has not arrived by then is a failure worth saying
      // out loud rather than a spinner somebody stares at while running.
      if (attempts > 60) { setAnswer("Timed out waiting for an answer."); return; }

      fetch("/api/prompt/" + encodeURIComponent(id))
        .then(function (response) { return response.json(); })
        .then(function (status) {
          // The job API answers { status, result, error } — nothing else.
          // Guessing at alternative field names here would turn a rename into
          // a silent "empty answer" rather than a visible failure.
          if (status.status === "done") {
            var text = status.result || "";
            setAnswer(text || "(empty answer)");
            speak(text);
            return;
          }
          if (status.status === "error") {
            setAnswer(status.error || "The answer failed.");
            return;
          }
          setTimeout(next, 1000);
        })
        .catch(function () { setTimeout(next, 1500); });
    })();
  }

  document.getElementById("typed").addEventListener("submit", function (event) {
    event.preventDefault();
    var input = document.getElementById("typed-input");
    var value = input.value.trim();
    if (!value) return;
    input.value = "";
    ask(value);
  });

  // --- the spoken day -----------------------------------------------------

  document.getElementById("speak-day").addEventListener("click", function () {
    setAnswer("Reading your day…", true);
    fetch("/api/speak/day")
      .then(function (response) { return response.json(); })
      .then(function (payload) { setAnswer(payload.text); speak(payload.text); })
      .catch(function () { setAnswer("Could not read your day."); });
  });

  document.getElementById("speak-insight").addEventListener("click", function () {
    setAnswer("Fetching today's insight…", true);
    fetch("/api/speak/insight")
      .then(function (response) { return response.json(); })
      .then(function (payload) {
        if (!payload.text) { setAnswer("No insight for today yet."); return; }
        setAnswer(payload.text);
        speak(payload.text);
      })
      .catch(function () { setAnswer("Could not fetch the insight."); });
  });

  // --- speech in: Web Speech where it works, recorded audio where it does not

  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var isAppleMobile = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // iOS Safari EXPOSES webkitSpeechRecognition and then does not reliably use
  // it. Feature detection is not enough here, which is why this is a platform
  // check rather than a capability check -- a rare case where that is correct.
  var useBrowserRecognition = !!Recognition && !isAppleMobile;

  if (useBrowserRecognition) {
    setUpBrowserRecognition();
  } else if (TRANSCRIPTION_CONFIGURED && navigator.mediaDevices && window.MediaRecorder) {
    setUpRecording();
  } else {
    talk.disabled = true;
    talk.textContent = "Voice off";
    iosNote.classList.remove("hidden");
    iosNote.innerHTML = !navigator.mediaDevices || !window.MediaRecorder
      ? "<strong>This browser cannot record audio.</strong> Typing below still works, and answers are still read aloud."
      : "<strong>Speech-to-text is not set up.</strong> This browser has no built-in speech " +
        "recognition, so a Groq API key is needed on the <a href='/dashboard'>dashboard</a>. " +
        "Typing below works now, and answers are read aloud either way.";
  }

  function setUpBrowserRecognition() {
    var recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    var finalText = "";

    recognition.onresult = function (event) {
      var interim = "";
      finalText = "";
      for (var i = 0; i < event.results.length; i++) {
        var chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += chunk;
        else interim += chunk;
      }
      transcriptEl.textContent = finalText || interim;
      transcriptEl.classList.toggle("interim", !finalText);
    };

    recognition.onerror = function (event) {
      setListening(false);
      transcriptEl.textContent =
        event.error === "not-allowed"
          ? "Microphone permission denied. Allow it in the browser's site settings."
          : "Could not hear that (" + event.error + "). Try again, or type it below.";
    };

    recognition.onend = function () {
      setListening(false);
      if (finalText.trim()) ask(finalText.trim());
    };

    bindHold(
      function () { finalText = ""; transcriptEl.textContent = "Listening…"; try { recognition.start(); } catch (e) {} },
      function () { try { recognition.stop(); } catch (e) {} }
    );
  }

  function setUpRecording() {
    var recorder = null;
    var chunks = [];

    // Safari produces mp4/aac and Chrome webm/opus; asking for an unsupported
    // type throws rather than degrading, so the type is negotiated rather than
    // assumed.
    function pickMimeType() {
      var candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];
      for (var i = 0; i < candidates.length; i++) {
        if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(candidates[i])) {
          return candidates[i];
        }
      }
      return "";
    }

    bindHold(
      function () {
        transcriptEl.textContent = "Listening…";
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(function (stream) {
            var mimeType = pickMimeType();
            recorder = mimeType ? new MediaRecorder(stream, { mimeType: mimeType }) : new MediaRecorder(stream);
            chunks = [];
            recorder.ondataavailable = function (event) { if (event.data.size) chunks.push(event.data); };
            recorder.onstop = function () {
              // Releasing the tracks matters: a live mic leaves the recording
              // indicator on and, on iOS, keeps the audio session captured so
              // speechSynthesis has nowhere to play the answer.
              stream.getTracks().forEach(function (track) { track.stop(); });
              sendAudio(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
            };
            recorder.start();
          })
          .catch(function () {
            setListening(false);
            transcriptEl.textContent = "Microphone permission denied. Allow it in site settings.";
          });
      },
      function () {
        setListening(false);
        if (recorder && recorder.state === "recording") recorder.stop();
      }
    );

    function sendAudio(blob) {
      if (!blob.size) { transcriptEl.textContent = "Nothing was recorded."; return; }
      transcriptEl.textContent = "Transcribing…";
      fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob
      })
        .then(function (response) {
          return response.json().then(function (payload) {
            if (!response.ok) throw new Error(payload.error || ("HTTP " + response.status));
            return payload;
          });
        })
        .then(function (payload) {
          if (payload.costUsd != null) {
            costEl.textContent = "Transcription cost about $" + payload.costUsd.toFixed(4) + ".";
          }
          if (!payload.text) { transcriptEl.textContent = "Nothing recognisable in that."; return; }
          ask(payload.text);
        })
        .catch(function (error) { transcriptEl.textContent = "Transcription failed: " + error.message; });
    }
  }

  function setListening(on) {
    talk.classList.toggle("listening", on);
    talk.textContent = on ? "Listening…" : "Hold to talk";
    hint.textContent = on ? "Let go when you are done." : "Hold the button, ask, let go.";
  }

  /**
   * Push to talk, on a touchscreen and a mouse.
   *
   * pointer events rather than touch+mouse: binding both fires twice on phones
   * that emulate mouse events, which starts recognition and immediately
   * restarts it. pointercancel is not optional either -- a scroll that steals
   * the gesture never sends pointerup, and without it the mic stays open.
   */
  function bindHold(onStart, onStop) {
    var held = false;

    function start(event) {
      if (held) return;
      event.preventDefault();
      held = true;
      setListening(true);
      onStart();
    }
    function stop() {
      if (!held) return;
      held = false;
      onStop();
    }

    talk.addEventListener("pointerdown", start);
    talk.addEventListener("pointerup", stop);
    talk.addEventListener("pointercancel", stop);
    talk.addEventListener("pointerleave", stop);
    talk.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  }
})();
</script>
</body>
</html>`;
}
