# PIPE core data semantics

PIPE has one absence value, `none`. It is represented explicitly in typed IR and by the reference interpreter; JavaScript `null`, `undefined`, truthiness, and array/object behavior are not language semantics. Equality with `none` is valid only for an optional value (or `none` itself).

`T?` is the union of exactly `T` and `none`. Optional narrowing is flow-sensitive for `if x != none` (the then branch) and `if x == none` (the else branch). An optional value used without narrowing is rejected by the type checker.

`list<T>` is immutable and homogeneous. A non-empty literal infers its element type. `[]` has no implicit `any` type and requires a contextual `list<T>`. Indexing requires an integer and returns `T?`; all invalid indexes produce `none`. `length` returns the non-negative integer list length and `contains` performs same-type equality.

`type Name { ... }` creates a record schema. A record value must provide every field exactly once, with no unknown fields and matching types. Field access is statically checked and evaluates to the stored value. Records have value semantics, no methods, inheritance, or hidden constructors.

`for item in values` accepts only `list<T>`, binds `item` to `T` inside the loop body, and does not leak the binding outside the loop. An empty list executes zero iterations. Each statement and iteration consumes interpreter steps; the existing deterministic `maxSteps` limit applies. A loop is never considered guaranteed to execute by return-path analysis.

The IR uses explicit `none`, `list`, `record`, `index`, `field`, and `for` nodes. The reference interpreter is the semantic oracle and exposes only structured `PIPE-RUNTIME-*` errors.
# Boundary semantics

The reference runtime uses explicit semantic values. Checked `integer` is signed int64 and may use BigInt internally. Its wire representation is a canonical decimal string. Exact `money` uses minor units and scale 2. The value contract is versioned and rejects malformed data.

`none`, JavaScript `null`, missing JSON properties, and SQL NULL are distinct. Adapters define conversions explicitly: optional database columns use SQL NULL, and JSON APIs may expose that database absence as JSON null. No compiler semantic rule treats host truthiness or object shape as a PIPE value.
