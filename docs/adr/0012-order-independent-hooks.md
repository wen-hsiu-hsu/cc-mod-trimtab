# Mods do not depend on hook order; only secret-scrub must be first

- Status: accepted
- Date: 2026-10-10

Hooks for the same event nest in the order of `enabledPlugins`, a plugin cannot declare its own order (type file: "same-event hooks nest in this order and no other way"), and `/plugin install` adds a new plugin at the end. So no feature of any mod may depend on the order: always hand off to `next`, stack in the shared band, and change state only after `next` let the event through (how, in the [development guide](../development.md#多個-mod-共存)).

The one thing that cannot be order-independent is who sees the original text first: a `prompt.submit` hook outside `secret-scrub` always sees the prompt before it is masked. So `secret-scrub` is always first, and the install docs say to install it first. For the same reason `secret-scrub` is not merged into another mod ([0014](0014-mod-grouping.md)).

Based on the Claude Code 2.1.294 type files and hands-on testing. Revisit if a way to declare order is added.
