/**
 * pnpm stripe:setup — creates the Pro product and its $12/month price in
 * Stripe TEST MODE and prints the price id for .env.local.
 *
 * Idempotent: run it as often as you like. The product has a fixed id and the
 * price a fixed lookup key, so a second run finds what the first one made
 * instead of creating duplicates.
 *
 * It refuses to run with a live key.
 */
import Stripe from "stripe";

const PRODUCT_ID = "fanout_pro";
const PRICE_LOOKUP_KEY = "fanout_pro_monthly";
const PRICE = { unit_amount: 1200, currency: "usd", interval: "month" } as const;

try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local: the key may come from the environment instead.
}

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("stripe:setup: STRIPE_SECRET_KEY is not set (add your test key to .env.local).");
  process.exit(1);
}
if (!/^(sk|rk)_test_/.test(key)) {
  console.error("stripe:setup: refusing to run — this is not a test-mode key (sk_test_…).");
  process.exit(1);
}

const stripe = new Stripe(key);

const isMissing = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "resource_missing";

async function ensureProduct(): Promise<string> {
  try {
    const product = await stripe.products.retrieve(PRODUCT_ID);
    if (!product.active) await stripe.products.update(PRODUCT_ID, { active: true });
    console.warn(`product  ${PRODUCT_ID} (exists)`);
  } catch (error) {
    if (!isMissing(error)) throw error;
    await stripe.products.create({
      id: PRODUCT_ID,
      name: "Fanout AI Pro",
      description: "100 generations a month, all lengths, the better model. Demo — test mode.",
    });
    console.warn(`product  ${PRODUCT_ID} (created)`);
  }
  return PRODUCT_ID;
}

async function ensurePrice(product: string): Promise<string> {
  const { data } = await stripe.prices.list({
    lookup_keys: [PRICE_LOOKUP_KEY],
    active: true,
    limit: 1,
  });
  const existing = data[0];
  const matches =
    existing &&
    existing.unit_amount === PRICE.unit_amount &&
    existing.currency === PRICE.currency &&
    existing.recurring?.interval === PRICE.interval &&
    (typeof existing.product === "string" ? existing.product : existing.product.id) === product;

  if (existing && matches) {
    console.warn(`price    ${existing.id} (exists)`);
    return existing.id;
  }

  // Prices are immutable: a changed amount means a new price that takes over the lookup key.
  const created = await stripe.prices.create({
    product,
    unit_amount: PRICE.unit_amount,
    currency: PRICE.currency,
    recurring: { interval: PRICE.interval },
    lookup_key: PRICE_LOOKUP_KEY,
    transfer_lookup_key: true,
  });
  console.warn(`price    ${created.id} (created)`);
  return created.id;
}

/** The Customer Portal needs its settings saved once per mode before sessions can be created. */
async function portalIsReady(): Promise<boolean> {
  const { data } = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  return data.length > 0;
}

try {
  const priceId = await ensurePrice(await ensureProduct());

  console.warn("\nAdd this to .env.local (and to the Vercel project later):\n");
  // The one line meant to be copied — plain stdout, so it can be piped.
  process.stdout.write(`STRIPE_PRO_PRICE_ID=${priceId}\n`);

  if (!(await portalIsReady())) {
    console.warn(
      "\nOne manual step left: the Customer Portal has no saved settings in test mode yet.\n" +
        "Open https://dashboard.stripe.com/test/settings/billing/portal, allow customers to\n" +
        'cancel subscriptions ("at end of billing period") and press Save.',
    );
  }
} catch (error) {
  console.error("stripe:setup failed —", error instanceof Error ? error.message : error);
  process.exit(1);
}
