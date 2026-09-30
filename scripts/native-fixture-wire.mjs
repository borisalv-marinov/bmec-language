export function injectFixtureWireLiterals(ir, mappings, executeValue) {
  if (!mappings) return;
  const replacements = new Map(Object.entries(mappings).map(([placeholder, functionName]) => [
    placeholder,
    String(executeValue(ir.functions, functionName, [])),
  ]));
  const visit = value => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'literal' && typeof value.value === 'string' && replacements.has(value.value))
      value.value = replacements.get(value.value);
    for (const child of Object.values(value)) visit(child);
  };
  for (const fn of ir.functions) visit(fn.body);
}
