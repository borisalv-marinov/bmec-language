# Northline Goods

Run the dogfood storefront from the repository root with `npm run dev:northline`.
It builds BMEC, starts the generated SQLite application, and seeds the three
catalog products on first run. Set `BMEC_PORT` to use another local port.

The cart UI has add and remove buttons, editable quantities, and a subtotal
preview. It saves valid quantities in browser local storage and restores them
on reload in the same browser. The checkout form sends one typed quantity for
each catalog product to the BMEC `POST /orders` route. The BMEC handler
validates all lines and computes the exact
money total from SQLite, and atomically stores one `pending-payment` order,
its item rows, and stock decrements. Checkout uses an idempotency key: matching
retries return the existing order, and a changed payload with the same key is
rejected. The browser preview is not trusted for checkout. No payment is
collected. Invalid or out-of-stock requests return a typed error without
creating an order or partially changing inventory. Orders and stock remain in
`.pipe/NorthlineGoods.db` across restarts.

The application seeds three demo products, not a six-product stationery
catalog. Its browser interop adapter owns cart controls, reload persistence, and
the subtotal preview; the BMEC route owns order, inventory, and idempotency
decisions. Browser persistence is a convenience and is not trusted by checkout.
