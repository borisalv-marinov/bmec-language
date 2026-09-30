# BMEC website machine entry points

The static website exposes `/ai` as a human-readable discovery page and
`/ai/index.json` as its stable machine discovery entry
point. Its contract is published as [`/ai/index.schema.json`](/ai/index.schema.json).
The index
links to catalogs by stable paths and declares each catalog’s schema version.

The language and UI entry points reference sections in the compiler-generated
`/ai/ai-spec.json`: constructs, syntax, types, operators, standard-library
contracts, controlled-English UI and style vocabularies, and page/style
projection schemas. The remaining entries link to the CLI command catalog,
the host capability catalog, diagnostics, checked examples, the curated
project showcase, and `/ai/knowledge-index.json` for compact exact-symbol
search. The packaged CLI provides the matching task-specific context output
with `bmec knowledge "TASK" --json`. `/llms.txt` points new agents to these
stable entry points and the public AI guide.
`/version.json` carries the current package version, language version, and
release status. The generated capability-coverage inventory connects public
capabilities to canonical compiler metadata, human guides, checked examples,
diagnostic references, and version labels. These public files are built from
package metadata, compiler output, and a checked-in coverage map; private
execution notes and historical evidence are not website inputs.

## Browser playground and editor connection

`/playground/` loads the bundled BMEC compiler and a bounded pure-function
runner into a short-lived browser Worker. It checks the full supported source
language, reports diagnostics and typed IR, and can run only the documented
safe subset. No edited source is sent to a website server. Its **Copy context
for AI** action copies compiler-generated context only after the user requests
it. `/docs/PLAYGROUND_GUIDE.md` explains the interaction and limits.

The VS Code extension is a separate download and uses the locally installed
`bmec` executable through its stdio language server. It is not a remote
compiler or an AI model connection. `/docs/BMEC_EDITOR_SETUP.md` gives the
installation and troubleshooting steps. The playground and editor setup are
linked from the main navigation and learning pages for direct discovery.
The human-readable [`How BMEC works` guide](/docs/how-bmec-works/) explains
the compiler pipeline, typed IR, target boundaries, and capability model.

The index is suitable for clients that begin with a fixed URL. It is not a
promise of an immutable schema: additions are versioned within the index and
catalogs retain their own schema identifiers. Consumers should ignore unknown
catalog ids and honor each catalog’s declared schema.
