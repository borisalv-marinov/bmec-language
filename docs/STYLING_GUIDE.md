# BMEC styling guide

Define named styles and attach them to pages or components. Styles are typed
and can compose other styles:

```bmec
style named Card { layout is column padding is 12 gap is 8 }
style named CardSmall { on small screens { padding is 8 } }
page Home { use style Card use style CardSmall }
```

The public style surface includes layout, alignment, dimensions, spacing,
typography, color, themes, responsive rules, and focus/hover/active/disabled
states. Check the accepted properties with `bmec ai-spec --json` and inspect
resolved facts with `bmec styles FILE --json`.

## Generated design tokens

Generated browser output includes a shared `--bmec-*` CSS custom-property
catalog for semantic colors, status colors, typography, spacing, sizing,
radii, borders, shadows, breakpoints, motion, focus, and disabled state. Typed
theme, focus, and disabled rules use these shared values, so applications that
compose the same named styles share a consistent visual foundation. The
catalog lives in the HTML renderer and does not change BMEC language or IR
compatibility versions.
