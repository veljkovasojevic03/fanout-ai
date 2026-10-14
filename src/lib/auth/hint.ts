/**
 * Set by the proxy on requests for the landing page: "1" when the session it
 * has just verified belongs to a user, "0" otherwise. A presentation hint only
 * (which buttons to show) — never an authorisation decision; /app checks the
 * user itself. The proxy always overwrites it, so a client cannot set it.
 */
export const SIGNED_IN_HEADER = "x-fanout-signed-in";
