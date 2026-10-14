# "Usage details" renames the words, not the keys

- Status: accepted
- Date: 2026-10-14

Each session's own usage record (the main session's tokens per day and every spawn, kept 90 days) was called 帳本 in Chinese and "ledger" in English. Beside the day rows (每日摘要) that outlive it, 帳本 read as bookkeeping. The messages and the docs now call it 用量明細 / "usage details", the pair of "day rows". Only text changes: the `ledger` setting, the store prefix `ledger:` and `ledger.ts` keep their names, and the docs still say `ledger` where they mean the setting.

Considered:
- Renaming the setting to a new key and reading `ledger` as a fallback: users who set it keep their choice, but the fallback stays in the code for good, and no one has the setting in their config today.
- Renaming the setting, the store prefix and the file: the store holds hundreds of session keys that would have to move while other sessions are writing them, and every session would need a reload, for a name users never see.

Consequences: code and English docs about the setting still say `ledger`, so the setting's name and the thing it records differ. A later rename of the setting needs its own migration.
