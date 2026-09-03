# TrainBud Privacy Policy

**Last updated:** September 4, 2026

TrainBud is an open-source Connect IQ app and companion server project maintained by Zsadigzade.

## Summary

TrainBud has no backend of its own. There is no TrainBud account, no TrainBud server, and
no telemetry — nothing is reported to the maintainers or to any third party. The watch
talks only to a server **you** run and a URL **you** enter. Your data goes where you send
it, and nowhere else.

TrainBud does keep two kinds of counter, and both stay on your own machine: how much your
AI provider key has been spent, and which app screens get opened. They exist so the
software can answer those questions to *you* — there is no endpoint to send them to and
none is planned. Both are described under "What is stored on your computer" below.

## What the watch app does

- Reads the **Server URL** you enter in the Connect IQ app settings on your phone
- Pairs with your server using a six-digit code you approve in the companion dashboard,
  then stores the resulting access token in Connect IQ local storage
- Sends authenticated requests to that server over HTTPS to fetch a health summary, and —
  only if you use the Ask AI card — to submit a preset question
- Includes, on that same summary request, the id of the card you were last looking at
  (for example `card=today`) and the app version. Your server counts these locally so the
  dashboard can show you which screens you actually use. It is sent to **your** server on
  a request the watch was already making, it is never sent anywhere else, and you can turn
  the counting off in the dashboard
- Displays the response and caches the last successful summary on the watch for offline
  viewing

The watch app sends nothing to the project maintainers, to analytics services, or to ad
networks. No account credentials are ever entered or stored on the watch.

## What the companion server does

When you run `trainbud serve` on your own computer:

- It reads your Connect account credentials from your local `.env` file
- It fetches your fitness data from Connect on your behalf
- It returns a compact summary to clients that present your API key or a paired token
- Session, cache and pairing files stay on your machine under `.trainbud/`

You control where the server runs, which tunnel URL you expose, and who holds the API key.

## What is stored on your computer

Everything in this section lives in `.trainbud/` on the machine running the server. None
of it is transmitted anywhere. There is no endpoint to send it to.

- **Your fitness history** — `history.db`, the measurements the server has fetched from
  Connect, so it can compare today against your own baseline rather than against a
  population average
- **Your profile** — name, units, primary sport, weekly goal, the thresholds at which a
  number turns amber or red, your watch card order, and your AI preferences. All of it is
  optional and all of it is set by you, in the dashboard
- **AI spending** — for each AI request: the time, the model, the token counts and the
  cost. This is what lets the dashboard show what your provider key has been spent this
  month and lets you set a cap. Deleting it would make a cap you had set wrong for the
  rest of the month, so it is kept for the billing month
- **Feature counters** — a per-day count of which watch cards you open and how often the
  Ask and sync paths run. On by default, because it never leaves the machine; you can
  switch it off in the dashboard under Privacy, and there is a button there to delete
  everything already counted. Turning it off stops the counting and does not, by itself,
  erase what is already stored

## AI features — read this before enabling them

AI features are **off by default** and only work once you add your own AI provider API key
in the companion dashboard.

When they are on:

- Your question, plus a summary of your recent health metrics (recovery, sleep, stress,
  heart rate, VO2 max and latest activity), is sent from **your** server to **Anthropic's
  API** using **your** API key
- Anthropic processes that request under its own terms and privacy policy — see
  <https://www.anthropic.com/legal/privacy>
- The generated text is stored in your local `.trainbud/app.db` job queue until it is read
- The daily AI Insight shown on the watch works the same way

If you never set an AI provider key, no health data leaves your own infrastructure.
Removing the key in the dashboard disables the feature again.

## Data stored on the watch

The app may persist the last successful summary, the paired access token, and the most
recent AI response in Connect IQ local storage, so the app is usable when your server is
unreachable. This stays on the watch until the app is removed or its storage is cleared.

## Third-party services

TrainBud interacts only with services you choose to configure:

| Service | When it is used | Whose terms apply |
|---------|-----------------|-------------------|
| Connect | Always — it is the source of your fitness data | The platform vendor's |
| Anthropic | Only if you enable AI features with your own key | Anthropic's |
| Your HTTPS tunnel provider | Whenever you expose your local server | The provider's |

## Permissions

The Connect IQ app requests only the **Communications** permission, so it can call the
HTTPS endpoint you configured.

## Health disclaimer

TrainBud provides general wellness and training information only. It is not a medical
device, it does not diagnose, treat, cure or prevent any condition, and nothing it
displays — including AI-generated text — is medical advice. Consult a qualified
professional before making health or training decisions.

## Contact

Project repository: <https://github.com/Zsadigzade/trainbud>

For privacy questions, open an issue on GitHub.

## Changes

This policy may be updated as the project evolves. The current version always lives at
`docs/PRIVACY-POLICY.md` in the repository.
