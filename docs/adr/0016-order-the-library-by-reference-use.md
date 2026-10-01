# Order the Library by Reference Use

The Library's time-based view is ordered by Reference Use rather than by when a Reference was added. Added time answers "when did this arrive", which stops being interesting once a Reference is in PinRef; use answers "what am I working with", which is the question a reference library is for. Added time is still recorded and still shown in the Inspector, and it remains the order of All Pins, so nothing about import history is lost.

Use covers both editing and viewing. Editing is assigning or removing a Tag, saving a Note, and saving a Name. Viewing is selecting a Reference in the Inspector, and seeing it as the Context Pin on Pinterest. Viewing counts because browsing a reference library is the work; a Reference you keep returning to is in use even when you change nothing. Trash, Restore and Permanent Delete are lifecycle operations and never count, so recovering a Reference does not disguise it as recently used.

Use is a timestamp with no field revision (ADR-0008), because it only moves forward: two writers cannot disagree about it, and a lost update costs nothing but ordering precision. It still travels through the worker's serialized command queue (ADR-0006) as `TOUCH_REFERENCES`, which ignores unknown and Trashed ids rather than failing, because a view is incidental to whatever the user was actually doing and must never surface an error. Repeat views of the same Reference within one minute record nothing, so routine panel refreshes on a single Pinterest Pin cannot turn passive viewing into a stream of writes.

Recently used fixes its order when the view is entered and re-reads use when the destination or Tag filter changes; reversing newest and oldest only flips the same fixed order. Ordering live would move a Reference to the front at the moment it is selected, reflowing the Gallery under the pointer and moving the next Pin the user was about to click. Freezing the order makes selection safe while keeping the view honest the next time it is opened.

References that predate this decision have no recorded use. They adopt their added time rather than a migration timestamp, so the first Recently used ordering matches the old Recently added ordering and then diverges as the Library is used.

Decided on 2026-10-01.
