# Confirm Pinterest Save before creating a Reference

PinRef creates a Reference only after Pinterest confirms Save for the same Pin and the local write commits successfully. The initial click creates a retryable Capture Attempt instead: this prevents false success when Pinterest is cancelled or fails, supports recovery when only the local write fails, and makes repeated Save observations idempotent without resetting saved time, Tags, Note, preview, or updated time.

Failed Capture Attempts remain separate from the Library and may be retried from the Side Panel or Dashboard. A repeated Save for an existing Reference is a no-op; it does not silently refresh metadata or modify user data.

When Pinterest's result cannot be determined, the Capture Attempt becomes `Save not confirmed` rather than success or failure. It remains bound to its original Pin across navigation and tabs, does not expire automatically, and stays recoverable until it succeeds or the user explicitly dismisses it in Dashboard. Dismissal removes only the Capture Attempt and never changes Pinterest Save state.

A Capture Attempt exists only while its Reference does not, so it is resolved as soon as the Pin enters the Library or leaves Trash, whatever caused that: Capture, Bootstrap Import, Restore or Permanent Delete all answer it. PinRef derives this from the current Library rather than transitioning each attempt, so Needs Attention stays aligned without the user visiting it. For the same reason a Save observed for a Pin already in the Library starts no attempt at all.

Dashboard collects these identity-known, incomplete attempts on a dedicated Needs Attention page. Content without a reliable Pin identity is not persisted as a provisional item: PinRef reports that it could not identify the Pin and performs no local write.

Revised on 2026-10-02. "Does not silently refresh metadata" stays the rule for everything the user owns or PinRef derived: the preview, the Pin identity, when it was added, Tags and Notes. Recording an image PinRef had never observed is the single exception, because a Pin of several images is partly unrecorded rather than stale (ADR-0015, revised).

Revised on 2026-10-01.
