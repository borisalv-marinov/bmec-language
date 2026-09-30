const quantities = {
  cup: {input: 'cupQuantity', sku: 'cup-01'},
  pourOver: {input: 'pourOverQuantity', sku: 'pour-over-01'},
  towel: {input: 'linenQuantity', sku: 'linen-01'},
};
const cartStorageKey = 'northline-cart-v1';

const inputFor = key => document.querySelector(`input[name="${quantities[key].input}"]`);
const moneyMinor = value => {
  if (value && typeof value === 'object' && /^-?\d+$/.test(String(value.minor)) && Number(value.scale) === 2) return BigInt(value.minor);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('catalog price is not a two-decimal money value');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const minor = BigInt(match[2]) * 100n + BigInt(fraction || '0');
  return match[1] === '-' ? -minor : minor;
};
const moneyText = minor => {
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-$' : '$'}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
const readQuantity = input => {
  const value = input?.value ?? '0';
  return /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? BigInt(value) : undefined;
};

async function startCartPreview() {
  const totalNode = () => document.querySelector('[data-pipe-style="CartSummaryTotal"] [data-pipe-text]');
  const rates = new Map();
  try {
    const response = await fetch('/api/Product', {credentials: 'same-origin'});
    if (!response.ok) throw new Error('catalog unavailable');
    for (const product of await response.json()) rates.set(product.sku, moneyMinor(product.price));
  } catch {
    if (totalNode()) totalNode().textContent = 'Subtotal unavailable';
  }

  const savedCart = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(cartStorageKey) ?? 'null');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.keys(quantities).map(key => {
        const value = saved[key];
        return [key, typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number.isSafeInteger(Number(value)) ? value : '0'];
      }));
    } catch {
      return {};
    }
  })();

  for (const key of Object.keys(quantities)) {
    const input = inputFor(key);
    if (!input) continue;
    input.value = savedCart[key] ?? (input.value === '' ? '0' : input.value);
    input.addEventListener('input', updateSubtotal);
    input.addEventListener('input', persistCart);
  }

  function persistCart() {
    try {
      const entries = Object.keys(quantities).map(key => [key, readQuantity(inputFor(key))]);
      if (entries.some(([, value]) => value === undefined)) return;
      localStorage.setItem(cartStorageKey, JSON.stringify(Object.fromEntries(
        entries.map(([key, value]) => [key, value.toString()]),
      )));
    } catch {
      // Keep cart interactions available when browser storage is disabled or full.
    }
  }

  function updateSubtotal() {
    let subtotal = 0n;
    for (const [key, item] of Object.entries(quantities)) {
      const quantity = readQuantity(inputFor(key));
      const price = rates.get(item.sku);
      if (quantity === undefined || price === undefined) {
        if (totalNode()) totalNode().textContent = 'Enter whole quantities to estimate the subtotal';
        return;
      }
      subtotal += price * quantity;
    }
    if (totalNode()) totalNode().textContent = moneyText(subtotal);
  }

  const add = key => {
    const input = inputFor(key), current = readQuantity(input);
    if (!input || current === undefined || current >= BigInt(Number.MAX_SAFE_INTEGER)) return;
    input.value = String(current + 1n);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const remove = key => {
    const input = inputFor(key);
    if (!input) return;
    input.value = '0';
    input.dispatchEvent(new Event('input', {bubbles: true}));
  };

  globalThis.PIPE_UI_EVENTS = {
    ...globalThis.PIPE_UI_EVENTS,
    addCup: () => add('cup'),
    addPourOver: () => add('pourOver'),
    addTowel: () => add('towel'),
    removeCup: () => remove('cup'),
    removePourOver: () => remove('pourOver'),
    removeTowel: () => remove('towel'),
  };
  updateSubtotal();
}

void startCartPreview();
