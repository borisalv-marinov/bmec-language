export function invalidFormInput(form: HTMLFormElement): HTMLInputElement | undefined {
  const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('[data-pipe-validation]'));
  for (const input of inputs) {
    input.dispatchEvent(typeof Event === 'function' ? new Event('input', { bubbles: true }) : ({ type: 'input' } as Event));
    if (input.dataset.pipeError) return input;
  }
  return undefined;
}
