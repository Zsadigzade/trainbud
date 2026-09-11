# Voice — asking out loud, and hearing the answer

`/voice` is a phone-first page: hold a button, ask a question, hear the answer
read back. It also reads your day and today's insight aloud on demand.

Open it at `https://YOUR-HOST/voice?token=YOUR_TRAINBUD_API_KEY` once — that
trades the key for a cookie and redirects to a clean `/voice`, so the address
bar never keeps the key. Bookmark it after the redirect.

## What it is not

**This is not a watch feature, and it cannot become one.** Connect IQ exposes no
microphone and no speaker to a widget on any device, and gives the watch no way
to trigger anything on the paired phone. The watch's Ask card stays what it is:
a menu of preset questions. Voice starts on the phone.

**This is not hands-free.** Mobile browsers suspend microphone access when the
tab is backgrounded or the screen goes off, so the phone has to be awake with
this page in front of you, per question. Phone-in-pocket, earbuds-only operation
would take a native app. The page says so on itself rather than letting you find
out mid-run.

## The two platforms are genuinely different

| | Android / Chrome | iPhone / Safari |
|---|---|---|
| Speech in | Web Speech API, in the browser | Records audio, posts it to `/api/transcribe` |
| Needs a key | No | Yes — a Groq key |
| Cost per question | Free | About $0.0001 |
| Speech out | `speechSynthesis` | `speechSynthesis` — works fine |

iOS Safari does expose `webkitSpeechRecognition`, and it is unreliable across
versions in a way that fails *silently*. Feature detection is not enough, so the
page checks the platform — one of the few cases where that is the correct call.
Text-to-speech needs no such split and works on both.

### Setting up iPhone speech

1. Get a key at [console.groq.com/keys](https://console.groq.com/keys)
2. Dashboard → **AI** → **Groq API key** → Save
3. Reload `/voice` on the phone

Groq's `whisper-large-v3-turbo` is about **$0.04 per hour of audio**, so a
ten-second question costs roughly a hundredth of a cent. Every call is recorded
in the usage table and counts against the spending cap you set on the dashboard.

Transcription is billed by audio duration rather than tokens, so those rows
carry zero tokens and a cost computed from seconds. A call whose duration the
provider did not report is recorded as **unpriced**, never as zero — a
zero-cost call would make a cap that can never trip.

## The two spoken summaries cost nothing

**Read me my day** and **Read today's insight** do not call a model.

- *Read me my day* is composed in code from the same payload the watch draws,
  so the watch, the dashboard and the spoken summary cannot disagree about what
  today was.
- *Read today's insight* speaks the insight **already cached** for today. It
  never generates a new one — a button that quietly spends money each time it is
  pressed is a button you cannot trust.

Both work with no AI key at all.

They are also written for an ear rather than an eye, which is a real difference:

- Symbols are spelled out. `1.6x` becomes "1.6 times", `+4 bpm` becomes
  "up 4 beats per minute". Left alone, synthesis reads them literally and the
  sentence becomes unintelligible.
- A metric with no measurement is **left out**, not announced. A screen can show
  a dash and the eye skips it; an ear cannot skip, and "sleep, unknown" mid-
  sentence sounds like a fault.
- If nothing at all was measured, that is itself the news, and it names the
  likely cause: sync your watch.

## Endpoints

| Route | Method | What it does |
|---|---|---|
| `/voice` | GET | The page. Cookie or bearer auth, same as `/dashboard` |
| `/api/transcribe` | POST | Raw audio body, `Content-Type` of the recording. Returns `{ text, seconds, costUsd }` |
| `/api/speak/day` | GET | `{ text, lines }` — composed in code, no model call |
| `/api/speak/insight` | GET | `{ text }` — today's cached insight, or `null` |
| `/api/prompt` | POST | Unchanged. The page supplies a transcript as the prompt |

`Content-Type` on the transcribe request matters: the provider picks its decoder
from the file extension, which is derived from that header. Safari records
`audio/mp4`, Chrome `audio/webm;codecs=opus`, and posting one under the other's
name fails inside the decoder with an error that says nothing about the cause.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Voice off" and a note about speech-to-text | iPhone with no Groq key | Add one on the dashboard, or type the question |
| Microphone permission denied | Browser site setting | Allow the microphone for this host. On iOS this needs HTTPS, which the tunnel already provides |
| Mic works, no sound comes back | The recording stream was never released | Fixed — the page stops every track on `onstop`. A live mic holds the iOS audio session and leaves synthesis nowhere to play |
| Recognition starts and instantly stops | Two listeners on one gesture | Fixed — the button binds pointer events only, never touch **and** mouse |
| Works on the desk, dies on a run | The tab was backgrounded or the screen locked | Expected. See "This is not hands-free" above |
| 401 on every request | The cookie expired | Open `/voice?token=YOUR_KEY` once more |

Related: [ALWAYS-ON.md](./ALWAYS-ON.md) · [WEB-MCP.md](./WEB-MCP.md)
