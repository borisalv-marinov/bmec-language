# Native compilation

BMEC can compile a documented subset of typed programs to generated C and a host C compiler. Use the native build only after checking the program against the current language and capability contracts.

```sh
bmec build main.bmec --native
```

Native output does not support every construct accepted by the reference runtime. Database models, server routes, browser pages, arbitrary dynamic collections, and unsupported values or operations cannot be assumed to work natively. The compiler reports constructs outside the current subset.

The [capability guide](CAPABILITIES.md#native-compilation), [generated coverage matrix](CAPABILITY_COVERAGE.md), and versioned [`bmec ai-spec --json`](../ai/ai-spec.md) contract describe the current boundary. The reference runtime remains the compatibility target when a program must run across supported application layers.