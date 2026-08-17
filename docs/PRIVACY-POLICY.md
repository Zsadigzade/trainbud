# TrainBud Privacy Policy

**Last updated:** August 17, 2026

TrainBud is an open-source Connect IQ app and companion server project maintained by Zsadigzade.

## Summary

TrainBud has no backend of its own. There is no TrainBud account, no TrainBud server, and
no telemetry. The watch talks only to a server **you** run and a URL **you** enter. Your
data goes where you send it, and nowhere else.

## What the watch app does

- Reads the **Server URL** you enter in the Connect IQ app settings on your phone
- Pairs with your server using a six-digit code you approve in the companion dashboard,
  then stores the resulting access token in Connect IQ local storage
- Sends authenticated requests to that server over HTTPS to fetch a health summary, and —
  only if you use the Ask AI card — to submit a preset question
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
