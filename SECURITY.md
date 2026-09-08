# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/Zsadigzade/trainbud/security/advisories/new).

That form is private to you and the maintainer until an advisory is published.
If it is unavailable to you for any reason, open a normal issue saying only that
you have a security report and would like a private channel — no details — and a
private route will be arranged.

Expect a first response within seven days. This is a one-maintainer project, not
a company with an on-call rota; that number is what can honestly be promised
rather than what sounds reassuring.

## What is in scope

TrainBud runs on your own machine, holds your Connect credentials in a local
`.env`, and can expose an HTTP surface for a paired watch. The interesting
boundaries are:

- **The HTTP server** (`trainbud serve`), including `/mcp`, `/api/watch`, the
  pairing endpoints and the dashboard — anything reachable through the tunnel a
  watch connects over.
- **Authentication**: the API key, the per-device pairing tokens, and the
  dashboard session cookie.
- **Credential handling and storage**: `.env`, `.trainbud/`, `app.db`, and
  anything that could write a secret into a log, an error message or a URL.
- **The published npm package and container image**, including what a
  postinstall or entrypoint executes.

## What is out of scope

- **Anything requiring an attacker to already have your machine or your
  `.env`.** Local files are trusted by design; this is a local-first tool.
- **Garmin Connect itself**, and the unofficial library used to reach it. Report
  those upstream.
- **Running `serve` bound to a public interface without a tunnel or a
  credential.** That is a deployment choice the documentation warns against.
- **Missing hardening that is already declared as accepted debt in the README or
  CHANGELOG**, such as `script-src 'unsafe-inline'` on the dashboard. A report
  arguing it should be prioritised is welcome as a normal issue.

## Supported versions

The latest published minor is supported. Fixes ship forward rather than being
backported, because the install path is `npx trainbud@latest`.

| Version | Supported |
| --- | --- |
| 0.7.x | ✅ |
| < 0.7 | ❌ — Node 20 could not install these without a C++ toolchain in the first place |

## Credentials, if you find one exposed

If you find a live credential of the maintainer's in this repository or in a
published artifact, treat it as urgent and report it privately. Do not open an
issue quoting it, and do not test it.
