const cartKey = 'paper-harbor-cart-v1';
const catalogUrl = '/products';
const checkoutUrl = '/orders';
const toMinor = value => {
  if (value && typeof value === 'object' && /^-?\d+$/.test(String(value.minor)) && Number(value.scale) === 2) return BigInt(value.minor);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Product price must have two decimal places.');
  const minor = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  return match[1] === '-' ? -minor : minor;
};
const moneyText = minor => {
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? '-$' : '$'}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
const readCart = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(cartKey) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([id, quantity]) => /^\d+$/.test(id) && Number.isSafeInteger(quantity) && quantity > 0));
  } catch { return {}; }
};

async function startPaperHarbor() {
  const catalog = document.querySelector('[data-pipe-list="products"]');
  const cartRoot = document.querySelector('[data-pipe-style="CartPanel"]');
  if (!catalog || !cartRoot) return;
  const status = document.createElement('p');
  status.className = 'store-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  cartRoot.replaceChildren();
  cartRoot.setAttribute('aria-label', 'Shopping cart');
  const productsById = new Map();
  const cart = readCart();
  let products = [];
  let selectedCategory = 'All categories';

  const saveCart = () => { try { localStorage.setItem(cartKey, JSON.stringify(cart)); } catch { status.textContent = 'Cart could not be saved in this browser.'; } };
  const searchInput = document.querySelector('[data-pipe-list-filter]');
  if (searchInput) searchInput.setAttribute('aria-label', 'Search products by name or description');
  const controls = catalog.closest('[data-pipe-list-control]') ?? catalog.parentElement;
  const categoryLabel = document.createElement('label');
  categoryLabel.className = 'category-filter';
  categoryLabel.append('Filter by category ');
  const categorySelect = document.createElement('select');
  categorySelect.setAttribute('aria-label', 'Filter by category');
  categoryLabel.append(categorySelect);
  const searchLabel = searchInput?.closest('label');
  if (searchLabel) searchLabel.after(categoryLabel);
  else controls?.prepend(categoryLabel);
  const categoryStatus = document.createElement('p');
  categoryStatus.className = 'store-status';
  categoryStatus.setAttribute('role', 'status');
  categoryStatus.setAttribute('aria-live', 'polite');
  catalog.parentElement?.append(categoryStatus);
  const listRegion = catalog.closest('[data-pipe-list-region]') ?? catalog;
  listRegion.after(cartRoot);

  const cardNodes = () => [...catalog.querySelectorAll('[data-pipe-style="ProductCard"]')];
  const productForCard = card => productsById.get(String(card.dataset.productId ?? ''));
  const applyCategory = () => {
    let shown = 0;
    for (const card of cardNodes()) {
      const product = productForCard(card);
      const visible = selectedCategory === 'All categories' || product?.category === selectedCategory;
      card.hidden = !visible;
      if (visible) shown++;
    }
    categoryStatus.textContent = shown === 0 && selectedCategory !== 'All categories' ? `No products in ${selectedCategory}.` : '';
  };
  categorySelect.addEventListener('change', () => { selectedCategory = categorySelect.value; applyCategory(); });

  const renderCart = () => {
    cartRoot.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Your cart';
    cartRoot.append(heading);
    const selected = Object.entries(cart).filter(([, quantity]) => Number.isSafeInteger(quantity) && quantity > 0);
    if (selected.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'Your cart is empty. Add a product to begin.';
      empty.setAttribute('role', 'status');
      cartRoot.append(empty);
      return;
    }
    let subtotal = 0n;
    const list = document.createElement('div');
    list.className = 'cart-lines';
    for (const [id, quantity] of selected) {
      const product = productsById.get(id);
      if (!product) continue;
      const line = document.createElement('div');
      line.className = 'cart-line';
      const label = document.createElement('label');
      label.textContent = `${product.name} quantity`;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = String(quantity);
      input.setAttribute('aria-label', `${product.name} quantity`);
      input.addEventListener('change', () => {
        const next = Number(input.value);
        if (!Number.isSafeInteger(next) || next < 0) { input.value = String(cart[id]); return; }
        if (next === 0) delete cart[id]; else cart[id] = next;
        saveCart();
        renderCart();
      });
      label.append(input);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = `Remove ${product.name}`;
      remove.addEventListener('click', () => { delete cart[id]; saveCart(); renderCart(); });
      const amount = document.createElement('span');
      amount.textContent = moneyText(toMinor(product.price) * BigInt(quantity));
      line.append(label, amount, remove);
      list.append(line);
      subtotal += toMinor(product.price) * BigInt(quantity);
    }
    const total = document.createElement('p');
    total.className = 'cart-subtotal';
    total.textContent = `Subtotal ${moneyText(subtotal)}`;
    list.append(total);
    cartRoot.append(list);

    const form = document.createElement('form');
    form.className = 'checkout-form';
    const formHeading = document.createElement('h3');
    formHeading.textContent = 'Delivery details';
    form.append(formHeading);
    const fields = [
      ['name', 'Your name', 'text', 2],
      ['email', 'Email address', 'email', 6],
      ['address', 'Delivery address', 'text', 8],
    ];
    for (const [name, labelText, type, minLength] of fields) {
      const label = document.createElement('label');
      label.textContent = labelText;
      const input = document.createElement('input');
      input.name = name;
      input.type = type;
      input.required = true;
      input.minLength = minLength;
      input.autocomplete = name === 'name' ? 'name' : name === 'email' ? 'email' : 'street-address';
      label.append(input);
      form.append(label);
    }
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Place demo order';
    form.append(submit);
    form.append(status);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      status.textContent = '';
      if (!form.reportValidity()) return;
      const payload = {
        name: form.elements.namedItem('name').value,
        email: form.elements.namedItem('email').value,
        address: form.elements.namedItem('address').value,
        items: selected.map(([id, quantity]) => ({productId: Number(id), quantity})),
      };
      const fingerprint = JSON.stringify(payload);
      let retry;
      try { retry = JSON.parse(sessionStorage.getItem('paper-harbor-pending') ?? 'null'); } catch { retry = null; }
      if (!retry || retry.fingerprint !== fingerprint) retry = {fingerprint, key: crypto.randomUUID()};
      try { sessionStorage.setItem('paper-harbor-pending', JSON.stringify(retry)); } catch {}
      submit.disabled = true;
      submit.textContent = 'Saving your order…';
      try {
        const response = await fetch(checkoutUrl, {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json', idempotencyKey: retry.key}, body: fingerprint});
        let result = {};
        try { result = await response.json(); } catch {}
        if (!response.ok || result.state === 'err') throw new Error(result.error || 'Order could not be placed. Please review your details and stock.');
        sessionStorage.removeItem('paper-harbor-pending');
        for (const key of Object.keys(cart)) delete cart[key];
        saveCart();
        const receipt = result.value ?? result;
        status.textContent = `Order ${receipt.orderId} saved as ${receipt.status}. No payment was collected.`;
        await refreshProducts();
        renderCart();
        cartRoot.append(status);
      } catch (error) {
        status.textContent = error.message || 'Order could not be placed. Please try again.';
      } finally {
        submit.disabled = false;
        submit.textContent = 'Place demo order';
      }
    });
    cartRoot.append(form);
  };

  const decorateCards = () => {
    for (const card of cardNodes()) {
      if (card.dataset.paperHarborReady === 'true') continue;
      const skuNode = card.querySelector('[data-pipe-bind="product.sku"]');
      const product = products.find(item => item.sku === skuNode?.textContent?.trim());
      if (!product) continue;
      card.dataset.paperHarborReady = 'true';
      card.dataset.productId = String(product.id);
      const sku = document.createElement('span');
      sku.className = 'product-sku';
      sku.textContent = product.sku;
      card.append(sku);
      const availability = document.createElement('p');
      availability.className = 'product-availability';
      availability.textContent = product.stock > 0 ? `${product.stock} in stock` : 'Out of stock';
      const actions = document.createElement('div');
      actions.className = 'product-actions';
      const details = document.createElement('button');
      details.type = 'button';
      details.textContent = `View details for ${product.name}`;
      details.addEventListener('click', () => {
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', product.name);
        const title = document.createElement('h2'); title.textContent = product.name;
        const description = document.createElement('p'); description.textContent = product.description;
        const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close details'; close.addEventListener('click', () => dialog.close());
        dialog.append(title, description, close);
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        document.body.append(dialog); dialog.showModal(); close.focus();
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = `Add ${product.name} to cart`;
      add.disabled = product.stock < 1;
      add.addEventListener('click', () => { cart[String(product.id)] = (cart[String(product.id)] ?? 0) + 1; saveCart(); renderCart(); });
      actions.append(details, add);
      card.append(availability, actions);
    }
    applyCategory();
  };
  const refreshProducts = async () => {
    const response = await fetch(catalogUrl, {credentials: 'same-origin'});
    if (!response.ok) throw new Error('Catalog is unavailable.');
    products = await response.json();
    productsById.clear();
    for (const product of products) productsById.set(String(product.id), product);
    const categories = ['All categories', ...new Set(products.map(product => product.category))];
    const previous = categorySelect.value || selectedCategory;
    categorySelect.replaceChildren(...categories.map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; }));
    selectedCategory = categories.includes(previous) ? previous : 'All categories';
    categorySelect.value = selectedCategory;
    decorateCards();
    for (const card of cardNodes()) {
      const product = productForCard(card);
      if (!product) continue;
      const stockNode = card.querySelector('[data-pipe-bind="product.stock"]');
      if (stockNode) stockNode.textContent = String(product.stock);
      const priceNode = card.querySelector('[data-pipe-bind="product.price"]');
      if (priceNode) priceNode.textContent = moneyText(toMinor(product.price));
      const availability = card.querySelector('.product-availability');
      if (availability) availability.textContent = product.stock > 0 ? `${product.stock} in stock` : 'Out of stock';
      const addButton = [...card.querySelectorAll('button')].find(button => button.textContent.startsWith('Add '));
      if (addButton) addButton.disabled = product.stock < 1;
    }
  };
  new MutationObserver(decorateCards).observe(catalog, {childList: true, subtree: true});
  try { await refreshProducts(); renderCart(); } catch (error) { status.textContent = error.message; cartRoot.append(status); }
  const savedNotice = sessionStorage.getItem('paper-harbor-notice');
  if (savedNotice) { sessionStorage.removeItem('paper-harbor-notice'); status.textContent = savedNotice; cartRoot.append(status); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void startPaperHarbor(), {once: true});
else void startPaperHarbor();
