import {parseAsync as parse} from "../parser/async.js";
import {PipeLexError} from "../lexer/lexer.js";
import {PipeParseError} from "../parser/parser.js";
import {analyzeProgram, analyzeUI} from "../semantic/analyze.js";
import {toIR, type ProjectIR} from "../ir/ir.js";
import type {Program, FunctionDeclaration, Declaration} from "../ast/ast.js";
import {diagnostic, type Diagnostic} from "../diagnostics/diagnostics.js";
import {functionId, type FunctionId} from "../identity.js";
import type {CompileBoundaryOptions} from "../compiler.js";
import {analyzeContracts} from "../semantic/contracts.js";
import {specializeGenericCallTypes} from "../core/analysis.js";
import {validatePartition} from "./partitions.js";
import {BMEC_STYLE_VALUES} from "../style/values.js";

export function compile(
  source: string,
  file = "<input>",
  boundary: CompileBoundaryOptions = {},
) {
  try {
    const ast = parse(source, file);
    const declarations = ast.declarations.flatMap((d) =>
      d.kind === "ImplDeclaration"
        ? d.methods
        : d.kind === "FunctionDeclaration"
          ? [d]
          : [],
    );
    const functionIds = new Map<FunctionDeclaration, FunctionId>(
      declarations.map((d, i) => [
        d,
        functionId(`FUNC-${String(i + 1).padStart(3, "0")}`),
      ]),
    );
    const semantic = analyzeProgram(ast, { functionIds });
    specializeGenericCallTypes(semantic.functions, semantic.index);
    const diagnostics = [
      ...semantic.diagnostics,
      ...analyzeUI(ast),
      ...analyzeContracts(ast, { functionIds, index: semantic.index })
        .diagnostics,
      ...styleDiagnostics(ast),
      ...(boundary.partition
        ? validatePartition(boundary.partition, boundary.references ?? []).map(
            (x) =>
              diagnostic(x.code, x.message, ast.span, {
                kind: "partition",
                received: x.identity,
              }),
          )
        : []),
    ];
    return {
      ast,
      diagnostics,
      ir: diagnostics.length ? undefined : toIR(ast, semantic),
    } as { ast: typeof ast; diagnostics: typeof diagnostics; ir?: ProjectIR };
  } catch (error) {
    if (error instanceof PipeLexError)
      return {
        ast: undefined,
        diagnostics: [
          diagnostic(
            error.code,
            error.message,
            { start: error.position, end: error.position },
            {
              kind: "syntax",
              suggestions: ["Check the token at this location."],
            },
          ),
        ],
        ir: undefined,
      } as { ast: undefined; diagnostics: Diagnostic[]; ir?: ProjectIR };
    if (error instanceof PipeParseError)
      return {
        ast: undefined,
        diagnostics: [
          diagnostic(error.code, error.message, error.token.span, {
            kind: error.context.kind ?? "syntax",
            suggestions: ["Check the surrounding declaration syntax."],
            ...error.context,
          }),
        ],
        ir: undefined,
      } as { ast: undefined; diagnostics: Diagnostic[]; ir?: ProjectIR };
    throw error;
  }
}

export function styleDiagnostics(program: Program): Diagnostic[] {
  const out: Diagnostic[] = [];
  const named = new Set(
    program.declarations
      .filter(
        (
          declaration,
        ): declaration is Extract<Declaration, { kind: "StyleDeclaration" }> =>
          declaration.kind === "StyleDeclaration" &&
          declaration.name !== undefined &&
          !declaration.token,
      )
      .map((declaration) => declaration.name!),
  );
  const styleDeclarations = new Map(
    program.declarations
      .filter((declaration): declaration is Extract<Declaration, { kind: "StyleDeclaration" }> => declaration.kind === "StyleDeclaration" && declaration.name !== undefined)
      .map(declaration => [declaration.name!, declaration] as const),
  );
  const visiting = new Set<string>(), visited = new Set<string>();
  const visitComposition = (name: string, declaration: Extract<Declaration, { kind: "StyleDeclaration" }>) => {
    if (visiting.has(name)) {
      out.push(diagnostic("PIPE-STYLE-019", `Cyclic BMEC style composition involving "${name}"`, declaration.span, { kind: "style_composition_cycle", received: name }));
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const base of styleDeclarations.get(name)?.composes ?? []) {
      const target = styleDeclarations.get(base);
      if (!target) out.push(diagnostic("PIPE-STYLE-018", `Unknown BMEC base style "${base}"`, declaration.span, { kind: "style_composition", received: base, suggestions: ["Compose a declared named style."] }));
      else visitComposition(base, target);
    }
    visiting.delete(name); visited.add(name);
  };
  for (const declaration of styleDeclarations.values()) visitComposition(declaration.name!, declaration);
  for (const declaration of program.declarations) {
    if (declaration.kind === "StyleDeclaration") {
      for (const value of declaration.values)
        if (!BMEC_STYLE_VALUES.has(value))
          out.push(
            diagnostic(
              "PIPE-STYLE-001",
              `Unknown BMEC style value "${value}"`,
              declaration.span,
              {
                kind: "style_value",
                received: value,
                expected: [...BMEC_STYLE_VALUES].join(", "),
                suggestions: [
                  "Use a supported BMEC style value or remove this value.",
                ],
              },
            ),
          );
      for (const [property, value] of [["padding", declaration.padding], ["gap", declaration.gap], ["margin", declaration.margin], ["width", declaration.width], ["height", declaration.height]] as const)
        if (value !== undefined && (!Number.isFinite(value) || value < 0))
          out.push(diagnostic("PIPE-STYLE-020", `Unsupported ${property} value "${value}"`, declaration.span, { kind: "style_dimension", received: String(value), suggestions: ["Use a non-negative finite number."] }));
      if (declaration.opacity !== undefined && (!Number.isFinite(declaration.opacity) || declaration.opacity < 0 || declaration.opacity > 1))
        out.push(diagnostic("PIPE-STYLE-028", `Unsupported opacity value "${declaration.opacity}"`, declaration.span, { kind: "style_opacity", received: String(declaration.opacity), suggestions: ["Use a percentage from 0 to 100."] }));
      for (const property of declaration.properties ?? [])
        if (property.name === "opacity" ? typeof property.value !== "number" || !Number.isFinite(property.value) || property.value < 0 || property.value > 1 : property.name === "background" ? property.value !== "blue" && property.value !== "neutral" && property.value !== "dark-blue" : property.name === "textColor" ? property.value !== "white" && property.value !== "black" && property.value !== "inherit" : true)
          out.push(
            diagnostic(
              "PIPE-STYLE-003",
              `Unsupported BMEC style property "${property.name} is ${property.value}"`,
              property.span,
              { kind: "style_property", received: `${property.name} is ${property.value}` },
            ),
          );
      for (const state of declaration.states ?? []) {
        if (state.state !== "hovered" && state.state !== "focused" && state.state !== "active" && state.state !== "disabled")
          out.push(diagnostic("PIPE-STYLE-004", `Unsupported BMEC style state "${state.state}"`, state.span, { kind: "style_state", received: state.state }));
        for (const property of state.properties)
          if (property.name === "opacity" ? typeof property.value !== "number" || !Number.isFinite(property.value) || property.value < 0 || property.value > 1 : property.name === "background" ? property.value !== "blue" && property.value !== "neutral" && property.value !== "dark-blue" : property.name === "textColor" ? property.value !== "white" && property.value !== "black" && property.value !== "inherit" : true)
            out.push(diagnostic("PIPE-STYLE-003", `Unsupported BMEC style property "${property.name} is ${property.value}"`, property.span, { kind: "style_property", received: `${property.name} is ${property.value}` }));
      }
      if (declaration.responsive !== undefined && declaration.responsive !== "stacked" && declaration.responsive !== "fluid")
        out.push(diagnostic("PIPE-STYLE-005", `Unsupported responsive BMEC style value "${declaration.responsive}"`, declaration.span, { kind: "style_responsive", received: declaration.responsive }));
      if (declaration.layout !== undefined && declaration.layout !== "row" && declaration.layout !== "column" && declaration.layout !== "grid")
        out.push(diagnostic("PIPE-STYLE-006", `Unsupported layout BMEC style value "${declaration.layout}"`, declaration.span, { kind: "style_layout", received: declaration.layout }));
      if (declaration.typography !== undefined && declaration.typography !== "readable" && declaration.typography !== "compact")
        out.push(diagnostic("PIPE-STYLE-007", `Unsupported typography BMEC style value "${declaration.typography}"`, declaration.span, { kind: "style_typography", received: declaration.typography }));
      if (declaration.spacing !== undefined && declaration.spacing !== "comfortable" && declaration.spacing !== "compact")
        out.push(diagnostic("PIPE-STYLE-008", `Unsupported spacing BMEC style value "${declaration.spacing}"`, declaration.span, { kind: "style_spacing", received: declaration.spacing }));
      if (declaration.theme !== undefined && declaration.theme !== "light" && declaration.theme !== "dark" && declaration.theme !== "calm" && declaration.theme !== "contrast")
        out.push(diagnostic("PIPE-STYLE-009", `Unsupported theme BMEC style value "${declaration.theme}"`, declaration.span, { kind: "style_theme", received: declaration.theme }));
      if (declaration.columns !== undefined && (!Number.isInteger(declaration.columns) || declaration.columns < 1))
        out.push(diagnostic("PIPE-STYLE-020", "Style columns must be a positive integer", declaration.span, { kind: "style_dimension", received: String(declaration.columns) }));
      if (declaration.responsiveColumns !== undefined && (!Number.isInteger(declaration.responsiveColumns) || declaration.responsiveColumns < 1))
        out.push(diagnostic("PIPE-STYLE-020", "Responsive style columns must be a positive integer", declaration.span, { kind: "style_dimension", received: String(declaration.responsiveColumns) }));
      if (declaration.responsiveGap !== undefined && (!Number.isFinite(declaration.responsiveGap) || declaration.responsiveGap < 0))
        out.push(diagnostic("PIPE-STYLE-020", "Responsive style gap must be non-negative", declaration.span, { kind: "style_dimension", received: String(declaration.responsiveGap) }));
      if (declaration.responsivePadding !== undefined && (!Number.isFinite(declaration.responsivePadding) || declaration.responsivePadding < 0))
        out.push(diagnostic("PIPE-STYLE-020", "Responsive style padding must be non-negative", declaration.span, { kind: "style_dimension", received: String(declaration.responsivePadding) }));
      if (declaration.responsiveMargin !== undefined && (!Number.isFinite(declaration.responsiveMargin) || declaration.responsiveMargin < 0))
        out.push(diagnostic("PIPE-STYLE-020", "Responsive style margin must be non-negative", declaration.span, { kind: "style_dimension", received: String(declaration.responsiveMargin) }));
      if (declaration.responsiveFontSize !== undefined && (!Number.isFinite(declaration.responsiveFontSize) || declaration.responsiveFontSize < 0))
        out.push(diagnostic("PIPE-STYLE-023", "Responsive style font size must be non-negative", declaration.span, { kind: "style_dimension", received: String(declaration.responsiveFontSize) }));
      if (declaration.responsiveLineHeight !== undefined && (!Number.isFinite(declaration.responsiveLineHeight) || declaration.responsiveLineHeight < 0))
        out.push(diagnostic("PIPE-STYLE-022", "Responsive style line height must be non-negative", declaration.span, { kind: "style_dimension", received: String(declaration.responsiveLineHeight) }));
      if (declaration.responsiveLayout !== undefined && declaration.responsiveLayout !== "row" && declaration.responsiveLayout !== "column" && declaration.responsiveLayout !== "grid")
        out.push(diagnostic("PIPE-STYLE-006", `Unsupported responsive layout BMEC style value "${declaration.responsiveLayout}"`, declaration.span, { kind: "style_layout", received: declaration.responsiveLayout }));
      if (declaration.color !== undefined && declaration.color !== "blue" && declaration.color !== "muted" && declaration.color !== "red" && declaration.color !== "green")
        out.push(diagnostic("PIPE-STYLE-010", `Unsupported color BMEC style value "${declaration.color}"`, declaration.span, { kind: "style_color", received: declaration.color }));
      if (declaration.border !== undefined && declaration.border !== "subtle" && declaration.border !== "strong" && declaration.border !== "red" && declaration.border !== "green")
        out.push(diagnostic("PIPE-STYLE-011", `Unsupported border BMEC style value "${declaration.border}"`, declaration.span, { kind: "style_border", received: declaration.border }));
      if (declaration.shadow !== undefined && declaration.shadow !== "soft" && declaration.shadow !== "strong")
        out.push(diagnostic("PIPE-STYLE-012", `Unsupported shadow BMEC style value "${declaration.shadow}"`, declaration.span, { kind: "style_shadow", received: declaration.shadow }));
      if (declaration.corners !== undefined && declaration.corners !== "rounded" && declaration.corners !== "pill")
        out.push(diagnostic("PIPE-STYLE-013", `Unsupported corner BMEC style value "${declaration.corners}"`, declaration.span, { kind: "style_corners", received: declaration.corners }));
      if (declaration.disabled !== undefined && declaration.disabled !== "guarded")
        out.push(diagnostic("PIPE-STYLE-014", `Unsupported disabled BMEC style value "${declaration.disabled}"`, declaration.span, { kind: "style_disabled", received: declaration.disabled }));
      if (declaration.textColor !== undefined && declaration.textColor !== "white" && declaration.textColor !== "black" && declaration.textColor !== "inherit")
        out.push(diagnostic("PIPE-STYLE-029", `Unsupported text color BMEC style value "${declaration.textColor}"`, declaration.span, { kind: "style_text_color", received: declaration.textColor }));
      if (declaration.focus !== undefined && declaration.focus !== "ringed")
        out.push(diagnostic("PIPE-STYLE-015", `Unsupported focus BMEC style value "${declaration.focus}"`, declaration.span, { kind: "style_focus", received: declaration.focus }));
      if (declaration.surface !== undefined && declaration.surface !== "elevated")
        out.push(diagnostic("PIPE-STYLE-016", `Unsupported surface BMEC style value "${declaration.surface}"`, declaration.span, { kind: "style_surface", received: declaration.surface }));
      if (declaration.text !== undefined && declaration.text !== "muted")
        out.push(diagnostic("PIPE-STYLE-017", `Unsupported text BMEC style value "${declaration.text}"`, declaration.span, { kind: "style_text", received: declaration.text }));
      if (declaration.transitionDuration !== undefined && (!Number.isFinite(declaration.transitionDuration) || declaration.transitionDuration < 0))
        out.push(diagnostic("PIPE-STYLE-031", "Transition duration must be a non-negative finite number of milliseconds", declaration.span, { kind: "style_transition_duration", received: String(declaration.transitionDuration), suggestions: ["Use a duration such as 150 milliseconds."] }));
      if (declaration.transitionProperty !== undefined && !["all", "background", "color", "transform", "opacity"].includes(declaration.transitionProperty))
        out.push(diagnostic("PIPE-STYLE-032", `Unsupported transition property "${declaration.transitionProperty}"`, declaration.span, { kind: "style_transition_property", received: declaration.transitionProperty }));
      if (declaration.transitionEasing !== undefined && declaration.transitionEasing !== "ease" && declaration.transitionEasing !== "linear")
        out.push(diagnostic("PIPE-STYLE-033", `Unsupported transition easing "${declaration.transitionEasing}"`, declaration.span, { kind: "style_transition_easing", received: declaration.transitionEasing }));
    }
    if (
      declaration.kind === "ComponentDeclaration" &&
      declaration.style &&
      !named.has(declaration.style)
    ) {
      const token = styleDeclarations.get(declaration.style)?.token;
      if (token)
        out.push(diagnostic("PIPE-STYLE-034", `Style token "${declaration.style}" must be composed into a named style before attachment`, declaration.span, { kind: "token_style_attachment", received: declaration.style, suggestions: ["Compose this token into a named style, then attach that style."] }));
      else out.push(
        diagnostic(
          "PIPE-STYLE-002",
          `Unknown named BMEC style "${declaration.style}"`,
          declaration.span,
          { kind: "style_attachment", received: declaration.style },
        ),
      );
    }
    if (declaration.kind === "PageDeclaration")
      for (const statement of declaration.statements)
        if (
          statement.kind === "PageUseStyleDeclaration" &&
          !named.has(statement.style)
        ) {
          const token = styleDeclarations.get(statement.style)?.token;
          if (token)
            out.push(diagnostic("PIPE-STYLE-034", `Style token "${statement.style}" must be composed into a named style before attachment`, statement.span, { kind: "token_style_attachment", received: statement.style, suggestions: ["Compose this token into a named style, then attach that style."] }));
          else out.push(
            diagnostic(
              "PIPE-STYLE-002",
              `Unknown named BMEC style "${statement.style}"`,
              statement.span,
              { kind: "style_attachment", received: statement.style },
            ),
          );
        }
  }
  return out;
}
