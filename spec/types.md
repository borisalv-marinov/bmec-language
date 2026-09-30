# PIPE types

`text` and `id` accept strings. `boolean` accepts `true` or `false`. `integer` is a checked signed 64-bit value. `number` is finite floating point. `money` is fixed-point with two fractional digits and deterministic half-up division rounding. Numeric types do not implicitly convert.

`none` is PIPE's single explicit absence value. `T?` is exactly `T | none`; a non-optional type cannot receive `none`, and conditions never use truthiness. `list<T>` is a built-in immutable homogeneous list type, not a general generic facility. `[]` requires a contextual `list<T>` type, for example `let users list<User> = []`. Indexing a list with an integer returns `T?`; negative and out-of-range indexes return `none`.

`type Name { field type ... }` declares an in-memory record. Records have no methods, inheritance, or hidden constructors. Record literals use `Name { field: value ... }`, require every declared field exactly once, and support field access with `value.field`.
# Semantic Type References

PIPE source type syntax is resolved into one canonical structured `TypeRef`. Primitive types are `text`, `integer`, `number`, `money`, `boolean`, `date`, `datetime`, and `id`; compound types are `T?` and `list<T>`. Record and model references carry the module-qualified declaration identity, not merely the spelling of the name.

`T?` is an optional value and `none` is its explicit absence value. Equality and assignability are different: `none` is assignable to `T?`, but `none` is not equal to `T?`. Lists may nest optionals and other lists without string parsing.
