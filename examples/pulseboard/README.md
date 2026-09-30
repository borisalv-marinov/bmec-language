# PulseBoard

A workspace task dashboard with persisted CRUD, owner and manager roles,
workspace memberships, per-user settings, and typed page-state metrics. Workspace
owners can change existing Member and Manager roles from the members page; managers
can inspect the roster but cannot change roles, and Owner memberships are protected.

The task GET route resolves the selected workspace from the signed-in user's
persisted membership. Owners and managers receive a 50-row workspace page;
members get a database-side workspace and owner filter before the row limit.
The typed page-state cursor loads the next 50 rows by unique task ID while
retaining those scope filters. Generated CRUD shows one server page at a time;
its search and sort operate on that page. Metrics use database-side counts,
and mutation handlers recheck ownership or manager access before writing.

The SQLite/HTTP gauntlet covers cross-user and cross-workspace denial, member
ownership beyond the first page, manager access to other members' tasks,
workspace switching, scoped metrics, settings validation, and owner-only membership
role changes with no-write denials. Role management covers existing memberships;
invitation and removal are not implemented. Desktop, tablet, and mobile showcase images are included in the website assets.
