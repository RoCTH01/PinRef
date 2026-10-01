# Confirm Pinterest Save before creating a Reference

PinRef creates a Reference only after Pinterest confirms Save for the same Pin and the local write commits successfully. The initial click creates a retryable Capture Attempt instead: this prevents false success when Pinterest is cancelled or fails, supports recovery when only the local write fails, and makes repeated Save observations idempotent without resetting saved time, Tags, Note, preview, or updated time.

Failed Capture Attempts remain separate from the Library and may be retried from the Side Panel or Dashboard. A repeated Save for an existing Reference is a no-op; it does not silently refresh metadata or modify user data.

When Pinterest's result cannot be determined, the Capture Attempt becomes `Save not confirmed` rather than success or failure. It remains bound to its original Pin across navigation and tabs, does not expire automatically, and stays recoverable until it succeeds or the user explicitly dismisses it in Dashboard. Dismissal removes only the Capture Attempt and never changes Pinterest Save state.

Dashboard collects these identity-known, incomplete attempts on a dedicated Needs Attention page. Content without a reliable Pin identity is not persisted as a provisional item: PinRef reports that it could not identify the Pin and performs no local write.
