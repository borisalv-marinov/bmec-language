# Use the BMEC browser playground

The playground is a small place to edit BMEC, check it with the real
compiler, and run a supported pure function. It is useful for learning
language behavior and sharing a compiler result with a coding assistant.

## Run your first function

1. Open **Start from a checked example** and choose **Hello World**.
2. Select **Check source**. The local compiler reports errors or confirms
   that the source is valid.
3. Choose the function to run. Leave the arguments as `[]` when the
   function takes no inputs.
4. Select **Run function** and read its return value in the Result panel.
5. Edit the function and repeat. Editing invalidates the previous check, so
   check again before running changed code.

Use `Ctrl+Enter` (or `⌘+Enter` on Mac) to check the source. The editor uses
plain BMEC text, supports Tab indentation, and limits source to 50,000
characters.

## Try arguments

Arguments are entered as a JSON array in the same order as the selected
function's parameters. For example, a function taking one integer can use:

```json
[21]
```

A function taking text and an integer can use:

```json
["BMEC", 2]
```

Use JSON values that match the parameter types shown in the function list.
The local runner accepts basic integers, numbers, text, booleans, and lists.
It rejects unsupported values and any function that needs capabilities or
asynchronous work.

## Read a compiler result

- **Result** shows the return value or a clear run limit.
- **Diagnostics** shows the compiler code, location, explanation, and repair
  suggestions when available.
- **Typed IR** shows the compiler's typed intermediate representation after
  a successful check.
- **AI context** gives a compact context pack generated from the source and
  the local compiler knowledge catalog.

Select **Copy AI context** after checking valid source. Paste it into the
coding assistant you use with a request such as:

> Help me make this small BMEC change. Use the attached compiler context as
> the authority for BMEC syntax and limits. Explain any check errors by code,
> make the smallest useful edit, and do not assume that the browser playground
> can access files, databases, network, or host capabilities.

The context is generated in your browser. It is copied to your clipboard only
when you press the copy button.

## Save your source and continue in VS Code

Select **Download .bmec** to save the current editor contents on your device.
Install the **BMEC VS Code extension** from the download link in the site
navigation, then follow the [editor setup guide](BMEC_EDITOR_SETUP.md) to
connect it to the matching CLI and local language server.

## What can run here

The checker compiles the full source language, but the browser runner executes
only a deliberate subset of pure functions. It supports basic values,
arithmetic, comparisons, conditions, lists, loops, and selected pure string
and integer helpers. It refuses functions that use files, databases, network,
processes, secrets, host capabilities, asynchronous calls, or unsupported
operations.

Each run occurs in a short-lived browser Worker with limits on source size,
steps, loop iterations, call depth, integer size, and elapsed time. A run is
stopped when it exceeds those bounds. The source is not uploaded to a server.

This page is not an app host. To try pages, routes, databases, or host-backed
functions, install BMEC locally and follow the [getting started guide](GETTING_STARTED.md).
