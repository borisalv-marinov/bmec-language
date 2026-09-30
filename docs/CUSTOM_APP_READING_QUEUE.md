# Build a personal reading queue

This walkthrough starts with a generated app, then replaces the starter source
with one developer-owned model, two authenticated routes, and a small UI.
Language syntax stays compiler-checked in the [example source](../examples/reading-queue/main.bmec).

## Start with a project

```sh
bmec new my-app
cd my-app
```

Keep the generated `bmec.toml` and `bmec.lock`. Replace `main.bmec` with the
source below. The stages are reflected in that complete file: first define
`Book`, then add `listMyBooks` and `addMyBook`, then require authentication on
both `/books` routes, and finally compose the form, sign-in screen, and list.

## Complete checked source

```bmec
app ReadingQueue {
  description "A personal reading queue with server-checked ownership."
}
type Principal {
  id text role text
}
model Book {
  title text required ownerId text required finished boolean required default false
}
type NewBook {
  title text required
}
async function listMyBooks(principal Principal, db capability<database>) -> task<list<Book>> {
  let userId = principal.id
  return wait for get books from Book where ownerId is userId ordered by id ascending limited to 100 using db
}
async function addMyBook(principal Principal, db capability<database>, body NewBook) -> task<integer> {
  let book = Book {
    title :body.title, ownerId :principal.id, finished :false
  }
  return wait for add book to Book using db
}
serve GET / books requiring authenticated and database with listMyBooks
serve POST / books requiring authenticated and database with addMyBook
component NewBookForm form {
  text "Add a book to your queue"
  input title text label "Book title" validate nonempty button "Add book" on AddBook
}
component BookRow {
  show book title
  show book finished
}
component PrivacyNote {
  text "Books saved here are visible only to your account."
}
component SignInForm form {
  text "Sign in to see your reading queue"
  input id text label "User ID" validate nonempty
  input password text label "Password" validate nonempty button "Sign in" on Login
}
component SignOutButton {
  button "Sign out" on Logout
}
page SignIn {
  use SignInForm link "Open my reading queue" to ReadingQueue
}
page ReadingQueue {
  use SignOutButton
  use style ReadingQueueLayout
  event AddBook(title text) sends POST "/books" use NewBookForm
  state books list<Book> from GET "/books"
  use PrivacyNote link "Sign in" to SignIn
  for each book in books show BookRow empty "Your queue is empty. Add a book to begin."
}
style named ReadingQueueLayout {
  layout is column alignment is stretch gap is 16 padding is 24 on small screens {
    padding is 12
  }
}
```

The `NewBook` request accepts a title only. `addMyBook` builds the stored
`Book` from that request and `principal.id`, so a client cannot choose a
record owner. `listMyBooks` filters in the database using the server principal
before returning rows. Authentication alone does not add that predicate; the
application must write it.

## Check, run, and build

```sh
bmec check main.bmec --json
bmec fmt main.bmec --check
bmec run main.bmec
```

The runtime provides `/auth/register`, `/auth/login`, and `/auth/logout`.
The `SignInForm` uses the built-in login action and the browser receives an
HttpOnly session cookie. Register or seed a local test account before opening
the sign-in page. Keep real passwords in a local secret store, not source.

After a successful `Add book` action, BMEC refreshes the page's declared GET
state and the new book appears. Failed requests keep the current list and show
an error status. Reopening or reloading the page also reads the current server
state. Browser page state is a view of server data, not the authorization
source.

To prepare a release build, run `bmec build main.bmec --release`. For the
editor workflow, install the CLI and the official BMEC VS Code extension.
Use `bmec knowledge "custom application" --json` or
`bmec knowledge "authenticated route" --json` to get task-specific language
context before extending the app.

## Prove owner isolation

The checked acceptance test starts two independent users, creates one book
for each, sends a forged `ownerId`, and checks the stored/read results. It
also checks anonymous denial. Run it with:

```sh
npm test -- --run tests/reading-queue.test.ts
```

A workspace app can replace the single owner predicate with a membership
check: first resolve the selected workspace from the verified principal's
membership, then include workspace and ownership/role predicates in every
query and write. Do not trust a workspace ID, owner ID, or role supplied by a
browser without checking it against server-side membership.
