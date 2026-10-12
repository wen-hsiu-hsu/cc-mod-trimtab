# When session-keeper keeps the cache warm

- Status: accepted
- Date: 2026-10-09

It does not send when the context is under 30k, while the TTL is not yet known, or with a 5m TTL (upstream does not detect the TTL and must be turned off by hand). Timing is derived from the last request time in `$.state`, so it survives a hot reload; after a fork the cache expiry is moved. Upstream: `schedule`, `onIdle` and `resumeSchedule` in `register.ts`.
