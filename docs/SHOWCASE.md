# Built with BMEC

The showcase is a curated project directory. It currently features Paper
Harbor, Job Booking, PulseBoard, and Community Issues. Project entries live in
[`website/showcase.json`](../website/showcase.json) and follow
[`website/showcase.schema.json`](../website/showcase.schema.json). The website
build validates the catalog before publishing it as `/showcase.json` and uses
the same records to render project cards.

Every preview image is captured from the named, running BMEC application. The
site build maps each catalog image path to its checked-in screenshot evidence;
it fails if a project source or screenshot is missing. Community Issues can be
captured again with `npm run capture:community-issues-showcase`.

Each entry needs a stable id, name, short description, category, maturity
status, BMEC areas used, source or project notes, an accessible preview, and a
plain disclosure of limitations. Status is `Demo`, `Prototype`, or `In use`;
it describes the project’s maturity, not a quality rating. Paths are
site-relative and must resolve in the built site. Do not include private
credentials or personal contact details.

To propose a listing, prepare the fields in the catalog format and open a
change against the BMEC repository. Listings are reviewed and published by
maintainers. This is an editorial static catalog: there is no account system,
automated submission endpoint, ranking, or moderation platform.
