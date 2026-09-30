# PIPE compiler invariants

- The parser performs no database, HTTP, filesystem, or environment work.
- The AST is syntax-level and contains no SQLite-specific information.
- Semantic validation completes before a runnable IR is returned.
- Invalid programs never produce executable IR through `compile`.
- Identical valid source produces deterministic IR and graph output.
- Runtime targets consume IR; they do not reparse PIPE source.
- Migration planning is transactional and validation failures cannot partially modify user data.
- Compiler failures are distinct from ordinary user diagnostics.
