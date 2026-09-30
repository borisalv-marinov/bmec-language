# PIPE diagnostics

Diagnostics are deterministic objects with stable code, severity, source file, line, column, human message, and optional path, kind, received value, suggestions, and repair. The machine-readable catalog `ai/diagnostics.json` is the category index. Categories are `PIPE-SYN`, `PIPE-TYPE`, `PIPE-REF`, `PIPE-MODEL`, `PIPE-UI`, `PIPE-AI`, `PIPE-RUNTIME`, `PIPE-RESULT`, `PIPE-FUNC`, and `PIPE-INTERNAL`.

Core data-model diagnostics include:

- `PIPE-TYPE-007`: invalid assignment or record field type
- `PIPE-TYPE-008`: invalid list element
- `PIPE-TYPE-009`: unknown record field
- `PIPE-TYPE-010`: duplicate record field
- `PIPE-TYPE-011`: missing record field or incompatible equality
- `PIPE-TYPE-013`: untyped empty list
- `PIPE-TYPE-014`: invalid iterable or non-list indexing
- `PIPE-TYPE-015`: wrong list index type
- `PIPE-TYPE-016`: field access on a non-record
- `PIPE-TYPE-017`: duplicate record type

Runtime bounds failures are language behavior: invalid list indexes return `none`. Host range/type exceptions are not exposed. Runtime resource exhaustion uses `PIPE-RUNTIME-006`; arithmetic, overflow, and numeric failures retain the existing `PIPE-RUNTIME-003` through `PIPE-RUNTIME-005` codes.
# Foundation diagnostics

Stable Result/stdlib diagnostics include `PIPE-RESULT-001` (invalid success value), `PIPE-RESULT-002` (invalid error value), `PIPE-RESULT-003` (inspection of a non-Result), `PIPE-RESULT-004` (unknown Result field), and `PIPE-RESULT-005` (unsafe extraction). Standard-library arity and argument failures use the existing `PIPE-FUNC-008` and `PIPE-FUNC-009` structured diagnostics.
