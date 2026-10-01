# Merge concurrent edits at field boundaries

PinRef never resolves concurrent editing by rewriting an entire Reference. Mutations carry field-level base revisions: independent Note and Tag changes merge, distinct Tag assignment operations commute, and a stale operation on the same assignment cannot silently reverse a newer committed result.

When the same Note is edited concurrently, PinRef preserves the Local Draft and the latest committed version, marks the draft Updated elsewhere, and lets the user use their draft, use the latest version, continue editing, or copy the draft. Only committed values propagate across surfaces; background updates never replace a dirty draft or change the foreground Context Pin.

Revised on 2026-10-01: the same-Note conflict flow is superseded by ADR-0014 (last committed write wins). Field-level merging and Tag Assignment rules are unchanged.
