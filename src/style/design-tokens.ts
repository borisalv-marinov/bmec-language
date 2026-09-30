/** Canonical visual values used by the typed-style HTML renderer. */
export const BMEC_DESIGN_TOKENS = {
  color: {
    brand: { "600": "#2563eb", "700": "#1d4ed8" },
    neutral: {
      "0": "#ffffff",
      "50": "#f8fafc",
      "100": "#f1f5f9",
      "200": "#e2e8f0",
      "300": "#cbd5e1",
      "400": "#94a3b8",
      "500": "#64748b",
      "600": "#475569",
      "700": "#334155",
      "800": "#1f2937",
      "900": "#172033",
      "950": "#111827",
      black: "#000000",
    },
    semantic: {
      text: { primary: "#172033", muted: "#475569", inverse: "#ffffff" },
      surface: { canvas: "#f8fafc", raised: "#ffffff", inverse: "#171717", inverseRaised: "#282828" },
      border: { subtle: "#e2e8f0", default: "#cbd5e1", strong: "#374151" },
      action: { primary: "#2563eb", primaryHover: "#1d4ed8" },
    },
    status: {
      success: { foreground: "#15803d", surface: "#f0fdf4", border: "#bbf7d0" },
      warning: { foreground: "#b45309", surface: "#fffbeb", border: "#fde68a" },
      error: { foreground: "#b91c1c", surface: "#fef2f2", border: "#fecaca" },
      info: { foreground: "#1d4ed8", surface: "#eff6ff", border: "#bfdbfe" },
    },
    focus: { ring: "#93c5fd", ringStrong: "#f59e0b", ringContrast: "#ffff00" },
  },
  typography: {
    fontFamily: {
      sans: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      mono: "ui-monospace, SFMono-Regular, Consolas, monospace",
    },
    fontSize: {
      xs: "0.75rem", sm: "0.875rem", base: "1rem", lg: "1.125rem",
      xl: "1.25rem", "2xl": "1.5rem", "3xl": "1.875rem",
    },
    lineHeight: { tight: "1.2", normal: "1.5", relaxed: "1.75" },
    fontWeight: { regular: "400", medium: "500", semibold: "600", bold: "700" },
  },
  spacing: {
    "0": "0", "1": "0.25rem", "2": "0.5rem", "3": "0.75rem", "4": "1rem",
    "5": "1.25rem", "6": "1.5rem", "8": "2rem", "10": "2.5rem", "12": "3rem",
  },
  sizing: { control: "2.5rem", header: "4rem", sidebar: "16rem", content: "75rem" },
  radius: { sm: "0.375rem", md: "0.5rem", lg: "0.75rem", pill: "999px" },
  borderWidth: { thin: "1px", strong: "2px" },
  shadow: {
    soft: "0 1px 2px #0f172a0d",
    raised: "0 4px 14px #0f172a0d",
    strong: "0 4px 16px #0004",
  },
  breakpoint: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" },
  motion: {
    fast: "120ms", standard: "180ms", slow: "300ms",
    easing: "cubic-bezier(0.2, 0, 0, 1)",
  },
  focus: { width: "3px", offset: "2px" },
  disabled: { opacity: "0.55" },
} as const;

type TokenPaths<T, Prefix extends string = ""> = {
  [Key in keyof T & string]: T[Key] extends string
    ? `${Prefix}${Key}`
    : TokenPaths<T[Key], `${Prefix}${Key}.`>;
}[keyof T & string];

export type BMECDesignTokenName = TokenPaths<typeof BMEC_DESIGN_TOKENS>;

const flattenTokens = (
  tokens: Record<string, unknown>,
  prefix = "",
): Array<[string, string]> =>
  Object.entries(tokens).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? [[path.replaceAll(".", "-").replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), value]]
      : flattenTokens(value as Record<string, unknown>, path);
  });

export const BMEC_DESIGN_TOKEN_CSS = `:root{${flattenTokens(BMEC_DESIGN_TOKENS)
  .map(([name, value]) => `--bmec-${name}:${value}`)
  .join(";")}}`;

export const designToken = (name: BMECDesignTokenName): string =>
  `var(--bmec-${name.replaceAll(".", "-").replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)})`;
