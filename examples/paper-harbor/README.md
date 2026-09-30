# Paper Harbor

Run the BMEC and SQLite storefront with `npm run dev:paper-harbor`. Set
`BMEC_PORT` to choose a port and `BMEC_DATA_DIR` to choose where its SQLite
database lives. The runner seeds six products on first launch and preserves
orders and stock when the server restarts.

The default browser path is generated from `main.bmec`: it loads the catalog,
supports name/description search, projects products into typed cart lines,
persists cart changes in browser storage, and submits checkout to the BMEC
route.

An optional compatibility adapter adds category filtering, detail dialogs,
subtotal display, and the broader cart experience. It is off by default; set
`BMEC_PAPER_HARBOR_USE_CART_ADAPTER=1` to enable it.

The BMEC server revalidates the customer, cart lines, product IDs, and stock.
Orders, exact line totals, and the order total are written while stock is
decremented in one transaction. Checkout keys make retries safe; reusing a key
for a different order is rejected. Orders are saved as `pending_payment`. No
payment is collected or sent to a provider. The clearly named
`future-payment-adapter.js` is an unused placeholder.