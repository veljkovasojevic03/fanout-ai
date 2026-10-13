import { asUserId, idOf, subscriptionState, type SubscriptionLike } from "./plans";

/*
 * What a verified Stripe event does to a profile (spec §5.10).
 *
 * No Stripe SDK and no database in this file: the route passes both in, which
 * is what lets the whole decision be unit-tested.
 *
 * The event's own payload is used only to find out WHICH subscription changed.
 * The subscription is then fetched again and its current state is applied —
 * Stripe does not deliver events in order, so a late "created" must not be
 * able to undo a "deleted".
 */

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;
export type HandledEventType = (typeof HANDLED_EVENTS)[number];

export const isHandledEvent = (type: string): type is HandledEventType =>
  (HANDLED_EVENTS as readonly string[]).includes(type);

/** The parts of a Stripe event this app reads. */
export type StripeEventLike = {
  id: string;
  type: string;
  data: { object: unknown };
};

export type SubscriptionRef = {
  subscriptionId: string;
  /** Our user id, when the event carries one we put there ourselves. */
  userId: string | null;
};

type Ref = string | { id: string } | null | undefined;
type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === "object" && value !== null;

/** Which subscription an event is about; null when it is not about one at all. */
export function subscriptionRefOf(event: StripeEventLike): SubscriptionRef | null {
  const object = event.data.object;
  if (!isObject(object)) return null;

  switch (event.type) {
    case "checkout.session.completed": {
      // One-off payments also complete a session; only subscriptions matter here.
      if (object.mode !== "subscription") return null;
      const subscriptionId = idOf(object.subscription as Ref);
      return subscriptionId
        ? { subscriptionId, userId: asUserId(object.client_reference_id) }
        : null;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      if (typeof object.id !== "string") return null;
      const metadata = isObject(object.metadata) ? object.metadata : {};
      return { subscriptionId: object.id, userId: asUserId(metadata.user_id) };
    }

    case "invoice.payment_failed": {
      const parent = isObject(object.parent) ? object.parent : {};
      const details = isObject(parent.subscription_details) ? parent.subscription_details : {};
      // Newer API versions nest it; older ones had it on the invoice.
      const subscriptionId = idOf((details.subscription ?? object.subscription) as Ref);
      const metadata = isObject(details.metadata) ? details.metadata : {};
      return subscriptionId ? { subscriptionId, userId: asUserId(metadata.user_id) } : null;
    }

    default:
      return null;
  }
}

/** The arguments of the `apply_stripe_event()` SQL function. */
export type ApplyStripeEvent = {
  eventId: string;
  eventType: string;
  customerId: string;
  userId: string | null;
  subscriptionId: string;
  status: string;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type ApplyOutcome = "applied" | "duplicate" | "ignored" | "no_user";

export type WebhookDeps = {
  /** True when this event id is already in `stripe_events`. */
  alreadyProcessed(eventId: string): Promise<boolean>;
  /** The subscription as it is in Stripe right now. */
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionLike>;
  /** Records the event and updates the profile, atomically. Throws when the database fails. */
  apply(input: ApplyStripeEvent): Promise<ApplyOutcome>;
};

export type WebhookOutcome = ApplyOutcome | "unhandled" | "irrelevant";

/**
 * Handles one event whose signature has ALREADY been verified.
 *
 * Idempotent twice over: a replayed event id is dropped (cheaply here, and
 * for certain inside `apply`, in the same transaction as the update), and
 * because the current subscription state is applied rather than the event's
 * snapshot, even a different event about the same change ends in the same row.
 *
 * Anything thrown by a dependency propagates, so the route answers 5xx and
 * Stripe tries again later.
 */
export async function processStripeEvent(
  event: StripeEventLike,
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  if (!isHandledEvent(event.type)) return "unhandled";

  const ref = subscriptionRefOf(event);
  if (!ref) return "irrelevant";

  if (await deps.alreadyProcessed(event.id)) return "duplicate";

  const state = subscriptionState(await deps.retrieveSubscription(ref.subscriptionId));
  if (!state.customerId) return "irrelevant";

  return deps.apply({
    eventId: event.id,
    eventType: event.type,
    customerId: state.customerId,
    // What our own server wrote at checkout wins over what the event repeats.
    userId: state.userId ?? ref.userId,
    subscriptionId: state.subscriptionId,
    status: state.status,
    periodEnd: state.periodEnd,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
  });
}
