# n8n — real publishing, locally

Fanout hands every publish job to a **dispatcher**. With `N8N_BASE_URL` empty that is the
simulated one (nothing is sent, everything is labelled "Simulated"). With n8n running and the two
variables below set, jobs are delivered for real: email through your SMTP account, Discord through
the channel's webhook.

n8n is **not** part of the public demo — it runs on your machine, next to `pnpm dev`.

```
app ──signed POST──▶ n8n webhook ──▶ verify HMAC ──▶ 202 ──▶ send ──▶ signed POST ──▶ app
                     /webhook/fanout-publish-{email,discord}                /api/publish/callback
```

Both directions are signed the same way: `X-Timestamp` (unix seconds) and
`X-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`, keyed with
`N8N_SHARED_SECRET`, compared in constant time, refused when older than five minutes.

## 1. Start n8n

Needs Docker Desktop (or any Docker engine with Compose).

```bash
cd n8n
cp .env.example .env        # set N8N_SHARED_SECRET and FANOUT_SMTP_FROM
docker compose up -d
```

Generate the secret with `openssl rand -hex 32` (at least 16 characters). Open
<http://localhost:5678> and create the local owner account n8n asks for.

## 2. Import the workflows

In n8n: **Workflows → Add workflow → ⋯ → Import from File**, once for each file:

- `workflows/publish-email.json`
- `workflows/publish-discord.json`

## 3. Add the SMTP credential (email workflow)

1. Open **Fanout — publish by email**, click the **Send email** node, and under _Credential_
   choose **Create new credential** (type _SMTP_).
2. For Gmail: host `smtp.gmail.com`, port `465`, SSL/TLS on, user = your Gmail address, password =
   an **app password** (Google Account → Security → 2-Step Verification → App passwords). Your
   normal password will not work.
3. Save. `FANOUT_SMTP_FROM` in `n8n/.env` should be that same address.

The SMTP credential lives in n8n's encrypted credential store. The app never sees it.

The Discord workflow needs no credential: the webhook URL arrives in the signed request.

## 4. Activate both workflows

Toggle **Active** (top right) on each. Only active workflows listen on the production URLs
(`/webhook/…`); the editor's "Listen for test event" uses `/webhook-test/…`, which the app does not
call.

## 5. Point the app at n8n

In the app's `.env.local`:

```bash
N8N_BASE_URL=http://localhost:5678
N8N_SHARED_SECRET=<the same value as in n8n/.env>
CRON_SECRET=<another random value, at least 16 characters>
```

Restart `pnpm dev`. The "Simulated" badges disappear from Settings → Publish destinations and from
the calendar.

## 6. Try it

- **Publish now:** open a piece in the library → **Publish** → _Email_ → **Publish now**. The job
  shows "Sending", then "Published" a moment later, when n8n calls back. Check your inbox.
- **Discord:** Settings → Publish destinations → connect a channel (Discord: _Edit channel →
  Integrations → Webhooks → New Webhook → Copy Webhook URL_) → **Send test message**, then publish
  a piece to it.
- **Scheduled:** schedule a piece two minutes ahead and run the local ticker in a second terminal:

  ```bash
  pnpm cron:dev        # calls POST /api/cron/tick every 30 seconds
  ```

  In production the same endpoint is called every five minutes by
  `.github/workflows/cron.yml`.

## How the app and n8n find each other

| Direction | URL                                              | Set in                      |
| --------- | ------------------------------------------------ | --------------------------- |
| app → n8n | `http://localhost:5678/webhook/fanout-publish-*` | `N8N_BASE_URL` (.env.local) |
| n8n → app | `http://host.docker.internal:3000/api/publish/…` | `FANOUT_APP_URL` (n8n/.env) |

`host.docker.internal` is how a container reaches the host's `localhost`; the compose file maps it
on Linux as well. No tunnel (ngrok etc.) is needed while both run on one machine. If the app runs
somewhere else, set `FANOUT_APP_URL` to an address the container can reach.

## Troubleshooting

| What you see                                       | Likely cause                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Job fails: "delivery service could not be reached" | n8n is not running, or `N8N_BASE_URL` is wrong.                                                        |
| Job fails: "delivery service refused… (HTTP 404)"  | The workflow is not **Active**.                                                                        |
| Job fails: "… (HTTP 500)"                          | Signature check failed in n8n: the two `N8N_SHARED_SECRET` values differ, or a clock is off by >5 min. |
| Job stays "Sending", then fails after 10 minutes   | n8n could not call back: check `FANOUT_APP_URL` and that the app is running. See n8n → Executions.     |
| "Destination did not accept the message"           | SMTP rejected the mail (credential, From address) or the Discord webhook was deleted.                  |
| Code node error about `crypto` or `$env`           | The compose file's `NODE_FUNCTION_ALLOW_BUILTIN` / `N8N_BLOCK_ENV_ACCESS_IN_NODE` were removed.        |

n8n keeps the full detail of every run under **Executions**; the app only ever stores a short
failure code.

## Notes

- The image is pinned (`n8nio/n8n:2.44.0`). After upgrading, re-test both workflows.
- `n8n/data/` holds n8n's database and is git-ignored.
- Discord posts are sent with `allowed_mentions: { parse: [] }`, so `@everyone` in a piece cannot
  ping a channel. Long pieces arrive as several messages (at most ten, 1.2 s apart).
