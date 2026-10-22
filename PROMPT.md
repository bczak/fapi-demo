# Starting prompt

This is the brief this app was built from, written as one prompt. It is a cleaned-up consolidation of the instructions given step by step while building it, so it also includes the refinements that came after the first version.

---

I need to build the second-round assignment for a FAPI programmer position: a simple order system. I'll deploy it to Railway later, but first it has to run locally.

## The assignment

- **Order page:** customer details, choose a product, quantity, the total recalculates automatically, submit.
- **Thank-you page:** recap of the order, the price including VAT, and a conversion to another currency using the current ČNB exchange rate.
- At least one **automated functional test**.
- **Bonus:** `docker-compose up` runs everything for local development (frontend and backend), plus a `Makefile` with `make dev` and `make test`.
- Must work: **form validation** (email, phone, and so on), **redirects** between the pages, **VAT calculation**, **ČNB integration**.

## Stack

- Docker Compose, React, Vite, Tailwind with shadcn/ui (default theme for now, I'll re-theme it later).
- Hono for the server, SQLite for the database, Drizzle as the ORM. TypeScript and SQL only.
- **No react-hook-form and no react-router.** Use the TanStack family instead: Router, Query and Form, with zod for validation.
- Frontend structured with Feature-Sliced Design.
- **Bun** instead of npm (latest stable), no `package-lock.json`.
- The git branch is `master`, not `main`.
- Keep it clean and simple. Ask me if some information is missing.

## What it should do

- The shop shows a **3-column product grid** with the price and an "Add to cart" button. There should be about 50 products with images from picsum.photos (4:3, landscape). Show 12 first and load 12 more on a "Load more" button, with a loading state.
- Once a product is in the cart, its button turns into a quantity stepper: `[− 2 +]` on the left and a red delete button on the right. Pressing "−" at 1 removes the item and brings back "Add to cart". In the cart itself the delete button goes before the minus.
- The header has a **cart icon with the item count**. Clicking it opens the cart as a **sheet** (a drawer, full screen on phones), not a modal. Everything has to be responsive.
- The checkout inside the cart has **3 steps**: review the items and the price, shipping information, and payment. In the payment step the customer chooses the currency (CZK, EUR or USD). The app checks the real, public ČNB exchange rate, shows the correct price in each currency, and saves the currency, the rate and the amount with the order so the admin sees it too.
- The order is **saved to the database by the API server**, never by the client. The server must not trust prices or exchange rates from the client.
- Validation errors must not make the layout jump: reserve space for the message instead of inserting it.
- No rubber-band "double scroll" of the whole page when swiping on a MacBook or a phone.
- Toasts appear at the bottom on mobile and in the bottom-right corner on desktop.
- A **RESTful API** for products and prices.
- A simple **admin page** that lists orders, protected by basic auth with `admin` / `password`. Clicking an order opens the same kind of sheet with all the order information, not just a row. When signed in, "Sign out" replaces the "Admin" link in the header.

## Quality

- **Biome** for linting and formatting.
- **React Doctor** with a score of 100/100, without disabling its rules.
- **GitHub Actions**: one workflow for lint, typecheck and tests, and one that runs React Doctor on every push to `master` and prints the report in the run.
- Fix the findings of a bug and security review: quantity limits after merging duplicate lines, idempotent order creation, no lost cart changes during checkout, UTF-8 admin credentials, no false promise of a confirmation email, strict validation of the ČNB data, paginated admin listing with an index, request limits and throttling, no credentials in the query cache, and frontend regression tests.

## Documentation

- A `README.md` with every point of the assignment as an accordion explaining how it was implemented, with screenshots (kept in git), plus how to run and test it.
- A short note at the top of the README (in English and Czech) explaining that AI was used, and how.
- This `PROMPT.md`.
