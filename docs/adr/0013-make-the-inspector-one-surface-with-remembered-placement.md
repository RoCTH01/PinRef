# Make the Inspector one surface with remembered placement

Date: 2026-10-01

PinRef has one Inspector rather than separate Side Panel and Dashboard detail views. Chrome's Side Panel is only a container: a Docked Inspector lives in it, and a Floating Inspector lives over the Dashboard. The Inspector's content follows where the user is. On Pinterest it shows This Pin or Import for the active tab (ADR-0002, ADR-0012) and keeps the Pinterest restrictions of ADR-0008 and ADR-0009: Bootstrap Import plus Tag and Note editing for one Context Pin, with no Trash, Restore, Permanent Delete, Merge or Global Delete. On Dashboard it shows the Dashboard selection with full Library management, including multi-selection and those Dashboard-only commands, even while hosted in the Side Panel.

Inspector Placement is a remembered preference. On Pinterest the Inspector is always Docked. Choosing Dashboard from the Docked Inspector opens Dashboard with the Inspector still Docked, now showing the Dashboard selection. On Dashboard the user may switch to Floating, which closes the Side Panel, or close the Inspector, which keeps its placement. Selecting a Pin or clicking the extension action on Dashboard reopens the Inspector in the remembered placement. Opening the Side Panel manually while Floating switches the placement to Docked, so a Floating Inspector never coexists with an open Side Panel. The Dashboard has no in-page Docked layout.

Considered: keeping the Side Panel strictly bound to the active Pinterest tab, with an in-page Dashboard dock. Rejected because it duplicated the Inspector, made "Docked" mean two different places, and lost the user's working surface when moving from Pinterest to Dashboard.
