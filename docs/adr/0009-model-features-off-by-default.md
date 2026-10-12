# Features that call a model are off by default and can be turned on for a while

- Status: accepted
- Date: 2026-10-11

| Feature | Mod | Model |
| --- | --- | --- |
| Keep the cache warm, offer a handoff when it expired | session-keeper | Main conversation model (fork) |
| Judge a new task | session-keeper | Haiku |
| Distill memory automatically | project-memory | Sonnet |

- **Off by default**, with a toast the first time each one runs in a session. Always-on is set in `/config` or `.local.json`; a committed repo file cannot turn them on.
- **Temporarily on**: stored in the session layer with an expiry; `/clear` starting a new session also ends it. `on` leaves an always-on feature as it is, and `off` turns it off only for this session. While on, each mod draws one gray line (`session-keeper on · keep_warm 1h42m`) at the top of its own band; always-on features are not listed.
- **Cost notes**: one table row per feature (model, when it is called, the amount each time, what is sent), followed by how to estimate, where it goes, that subscriptions are not billed by token, and how to turn it on. No worked prices, so price changes do not make the docs wrong.
