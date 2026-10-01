# Drop Preview Reload and Pinterest status checks

Date: 2026-10-01

PinRef records a Reference only after Pinterest confirms the user's Save, or when Import finds the Pin in the user's own Saved Pins or Board. A stored "Unknown" Pinterest Link Status on every Reference therefore told the user nothing, and the manual Reload preview and Check Pinterest status actions that fed it added controls without adding information.

The Inspector no longer shows Pinterest Link Status for References and offers neither Reload preview nor Check Pinterest status. The worker no longer accepts preview or status updates for References. This supersedes ADR-0007 and narrows ADR-0003 and ADR-0010.

Existing `linkStatus` values stay in storage untouched. They are not displayed, migrated, or deleted. For a Context Pin without a Reference, the Inspector still uses the Pin's observed Pinterest Save state to explain the next step (ADR-0003); that observation is never stored.

Considered: deriving the status from the Pin URL, or refreshing it automatically while the Pin is open. Rejected because the URL identifies the Pin but proves nothing about its Save state, and a status the user cannot act on is noise.

Revised on 2026-10-02 (Pin Images). A Pin can be of several images, and the one PinRef previewed is not the whole Pin. The worker now accepts one narrow addition: while Pinterest is already showing a Pin the user has a Reference for, PinRef records the images it had never observed. The addition is add-only, so the Reference's preview, Pin identity, when it was added, its Tags and its Note never change; PinRef issues no request for it; and no control is added for the user to trigger it. Everything this ADR rejected — a control the user must press, and a status PinRef must go and ask Pinterest for — stays rejected. ADR-0016 set the precedent that viewing a Pin may write to its Reference.
