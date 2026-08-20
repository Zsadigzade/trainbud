# Test fixtures

**A fixture is only worth having if it came off the wire.**

The stress mapper shipped broken for months because its test was written against
a payload nobody had ever received. It read `overallStressLevel`; Connect sends
`avgStressLevel`. The test passed because it asserted against the same
invention, so a mapper that returned nothing on every real day looked covered.
`tests/rawApi.test.ts` keeps both versions side by side as the record of it.

The same session found `wellness/dailyStress?date=` (Connect wants the date as a
path segment) and `maxmet/daily/` (it is `maxmet/latest/`) — two endpoints that
had answered 404 every day since they were written, each swallowed per-day and
reported as "no data".

None of those were type errors. None would have been caught by a hand-written
fixture. They were caught by looking at a real response.

## Capturing

```bash
trainbud backfill --days 7 --capture tests/fixtures/garmin
```

One file per source and date: `sleep-2026-08-19.json`,
`heart_rate-2026-08-19.json`, and so on. Identity fields are replaced with
`<redacted>` on the way out — see `src/history/capture.ts` and its test for
exactly which keys, and note that **no measurement and no date is redacted**. A
fixture with its numbers scrubbed would be worse than the invented payload it
replaces.

## Before committing one

Redaction is a safety net, not a review. Read the file.

- [ ] No name, email, profile id, device id, or serial.
- [ ] No token, key or session value.
- [ ] No GPS coordinates, and no activity that starts at your front door.
- [ ] The measurements are still there and still real.

If the payload cannot be scrubbed to that standard, do not commit it — write a
test against the mapper's behaviour instead and say in the test why there is no
fixture.

## Using one

Load the JSON and feed it to the mapper, not to a fetcher. The mappers in
`src/garmin/daily.ts` and `src/garmin/rawApi.ts` are pure and take the parsed
response directly, which is what makes this possible with no network and no
account.
