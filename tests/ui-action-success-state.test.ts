import {describe, expect, it} from 'vitest';
import {readFileSync, mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import vm from 'node:vm';
import {compile} from '../src/compiler.js';
import {validateSerializedIR} from '../src/ir/validate.js';
import {formatSource} from '../src/tooling/formatter.js';
import {buildRelease} from '../src/release/release.js';

const source = `app Shop
type CartLine { productId id quantity integer }
type CheckoutRequest { token text }
function placeOrder(body CheckoutRequest) -> text { return body.token }
http POST /checkout -> placeOrder
component CheckoutForm form { input token text button "Place order" on checkout }
page Store {
  state cart list<CartLine> = [] persisted in local storage
  event checkout(token text) sends POST "/checkout" then clears cart on success
  use CheckoutForm
}`;

describe('typed page action success state updates', () => {
  it('formats and lowers a post-success persisted-list clear', () => {
    const formatted = formatSource(source);
    expect(formatted).toContain('then clears cart on success');
    expect(formatSource(formatted)).toBe(formatted);
    const compiled = compile(formatted);
    expect(compiled.diagnostics).toEqual([]);
    expect(validateSerializedIR(compiled.ir).valid).toBe(true);
    const page = compiled.ir!.ui!.components.find(component => component.name === 'Store')!;
    expect(page.events[0]).toMatchObject({
      name: 'checkout',
      action: {method: 'POST', path: '/checkout'},
      successUpdate: {operation: 'clear', state: 'cart', storageKey: 'bmec-state:Shop:UI-001:cart'},
    });
  });

  it('rejects a clear without an HTTP action or persisted list state', () => {
    const noAction = compile(source.replace(' sends POST "/checkout"', '').replace('then clears cart on success', 'then clears cart on success'));
    expect(noAction.diagnostics.map(diagnostic => diagnostic.code)).toContain('PIPE-UI-024');
    const notPersisted = compile(source.replace(' persisted in local storage', ''));
    expect(notPersisted.diagnostics.map(diagnostic => diagnostic.code)).toContain('PIPE-UI-024');
  });

  it.each([
    ['successful response', async () => ({ok: true, json: async () => ({state: 'ok', value: 'created'})}), true],
    ['typed application error', async () => ({ok: true, json: async () => ({state: 'err', error: 'Out of stock'})}), false],
    ['HTTP failure', async () => ({ok: false, json: async () => ({})}), false],
    ['network failure', async () => { throw new Error('offline'); }, false],
  ])('clears the persisted cart only after a successful response', async (_label, fetchResponse, shouldClear) => {
    const compiled = compile(source);
    expect(compiled.diagnostics).toEqual([]);
    const directory = join(mkdtempSync(join(tmpdir(), 'bmec-action-success-clear-')), 'release');
    buildRelease(compiled.ir!, directory, {packageName: 'shop', packageVersion: '0.1.0', languageVersion: '0.1-alpha'});
    const page = compiled.ir!.ui!.components.find(component => component.name === 'Store')!;
    const update = page.events[0]!.successUpdate!;
    const storage = new Map<string, string>([[update.storageKey!, JSON.stringify([{productId: 'cup-1', quantity: 2}])]]);
    const form: any = {elements: {namedItem: (name: string) => name === 'token' ? {value: 'checkout-1', dataset: {pipeType: 'text'}} : undefined}, querySelectorAll: () => []};
    const status: any = {dataset: {pipeActionStatus: 'checkout'}, textContent: '', setAttribute() {}};
    const button: any = {
      dataset: {pipeEvent: 'checkout', pipeAction: JSON.stringify({method: 'POST', path: '/checkout', fields: {token: 'text'}, successUpdate: update})},
      listeners: {} as Record<string, (event: any) => void>,
      closest: () => form,
      nextElementSibling: status,
      addEventListener(name: string, handler: (event: any) => void) { this.listeners[name] = handler; },
    };
    const document = {querySelectorAll(selector: string) { return selector === 'button[data-pipe-event]' ? [button] : []; }};
    const localStorage = {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key)};
    const context: any = {document, location: {hash: '', pathname: '/'}, localStorage, FormData: class { [Symbol.iterator]() { return [['token', 'checkout-1']][Symbol.iterator](); } }, fetch: fetchResponse};
    vm.runInNewContext(readFileSync(join(directory, 'app.js'), 'utf8'), context);
    button.listeners.click({preventDefault() {}});
    await new Promise(resolve => setTimeout(resolve, 0));
    const actual = JSON.parse(storage.get(update.storageKey!)!);
    expect(actual).toEqual(shouldClear ? [] : [{productId: 'cup-1', quantity: 2}]);
    expect(context.PIPE_UI_STATE.cart).toEqual(shouldClear ? [] : [{productId: 'cup-1', quantity: 2}]);
  });
});
