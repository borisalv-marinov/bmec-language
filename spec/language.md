# PIPE 0.1 Alpha-half

Modules use named static imports such as `import { Product } from "./models.pipe"`. Paths are relative to the importing file, require `.pipe`, and remain inside the entry project root. Imports are not transitive. A module sees only its declarations and explicitly imported names.

PIPE is whitespace-insensitive. `#` and `//` start comments. Identifiers start with a letter or underscore. Strings use single or double quotes; blocks use braces.

Declarations are `app`, `model`, `type`, `page`, `api`, `function`, and `style`. `model` is persistent/application data; `type` declares a general in-memory record. Functions use immutable local bindings. Statements are `let`, `return`, `if`/`else`, and `for item in list`.

Typed lambdas use one explicit form: `lambda(x integer) -> integer { return x + 1 }`.
Lambdas may be assigned, passed as callbacks, returned, and nested. They capture
only referenced outer immutable bindings by value. The current higher-order list
operations are `map`, `filter`, `fold`, `find`, `any`, and `all`.

Core data examples:

```pipe
type User { name text nickname text? }

function names(users list<User>) -> list<text> {
    let empty list<text> = []
    for user in users {
        if user.nickname != none {
            return [user.name]
        }
    }
    return empty
}
```

`none` is the only absence value. `T?` is `T` or `none`; explicit comparison with `none` is required before using an optional as its underlying type. There is no truthiness. Lists are immutable homogeneous values. `list[index]` returns `T?`, with invalid indexes returning `none`. `length(list)` and `contains(list, value)` are the intentionally small initial list API.
# Standard library and Result

The small built-in library is typed and non-mutating. Text operations are `trim`, `lower`, `upper`, `textLength`, `textContains`, `startsWith`, and `endsWith`. Numeric operations use distinct names where overloads would otherwise be required: `absInt`, `absNumber`, `minInt`, and `maxInt`; `floor`, `ceil`, and `round` accept `number`. Lists retain `length` and `contains`, and add `first` and `last`, which return an optional element.

`result<T,E>` has exactly two constructors: `ok(value)` and `err(error)`. Use `isOk(result)` or `isErr(result)` before extracting `.value` or `.error`. The compiler narrows the selected field; extraction without narrowing is rejected. Result is for expected application failures, while overflow, division by zero, and resource exhaustion remain runtime failures.
