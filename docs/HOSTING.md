# Hosting: `<project>.krachtzen.com` on Cloudflare (free)

## Today (checked 2026-11-04)

```
phone ─► Cloudflare (krachtzen.com zone, free)
           ├─ krachtzen.com/why_are_you_like_this/*  ─old Worker─►  why-are-you-like-this.onrender.com (Render free)
           └─ everything else                         ─► 522 (proxied record with no working origin)
```

- **Registrar:** Namecheap (email forwarding MX records).
- **DNS/TLS:** Cloudflare Universal SSL covers `krachtzen.com` and `*.krachtzen.com`.
- **Netlify:** not used.
- **Render free:** cold start of about 1 minute, and **the disk is wiped on every restart or spin-down, so games in progress are lost**.

## Target

```
why-are-you-like-this.krachtzen.com ─► Worker "why-are-you-like-this" ─► Durable Object per room
krachtzen.com/why_are_you_like_this/* ─► same Worker (old links keep working)
next-thing.krachtzen.com             ─► its own Worker / Pages project
```

- **One subdomain per game or side project.** One level of subdomain, so the free Universal SSL already covers it (no `.apps.` level).
- **Everything on the Workers Free plan.** No cold starts, and game state lives in Durable Object storage. A deploy or restart only freezes the clock until players reconnect, which they do automatically.
- **Static files are served by Cloudflare directly** and don't count toward Worker requests.

### Free plan budget (the parts we use)
- The free plan covers SQLite-backed Durable Objects, Worker requests, and static assets. If you go over, Cloudflare returns errors for the rest of that day rather than billing you.
- A party game is tiny next to the daily limits. WebSocket keep-alive pings are answered by the runtime without waking the room.
- Rooms delete themselves after 12 hours with nobody online.
- Check current numbers at https://developers.cloudflare.com/durable-objects/platform/pricing/ and https://developers.cloudflare.com/workers/platform/pricing/.

## Cut-over steps (one time, ~10 min)

1. **Log in:** `npx wrangler login`. Use the Cloudflare account that owns `krachtzen.com`.
2. **Free the old route:** Dashboard → Workers & Pages → the *old* worker → Settings → Domains & Routes → delete `krachtzen.com/why_are_you_like_this*`. Only one Worker can own a route.
3. **Deploy:**
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npm run deploy
   ```
   This creates `why-are-you-like-this.krachtzen.com`, including its DNS record and certificate, and takes over the legacy path.
4. **Check:** open both URLs and play a round with two phones.
5. **Clean up:**
   - Delete the old Worker and the Render service.
   - On Render, **turn off auto-deploy first** if it's linked to this repo, because the Node server no longer exists and a deploy from `main` would fail.
6. **Optional:** fix the 522 on the bare `krachtzen.com` with a small landing page listing your projects. Cloudflare Pages is free. Give it the apex as a custom domain.

The words removed with "Remove word" on the old Render server can't be recovered (its disk was ephemeral). New removals are stored in the Directory Durable Object, and you can manage them on `/admin`.

## Adding the next project
- **Static site:** Cloudflare Pages, with custom domain `name.krachtzen.com`.
- **Multiplayer game:** copy this repo's `worker/` pattern. Each room is a Durable Object with hibernatable WebSockets and storage, one alarm drives the timers, and the game rules stay in a pure module.
- **Anything:** `routes = [{ pattern = "name.krachtzen.com", custom_domain = true }]` in its `wrangler.toml`, then `wrangler deploy`. No manual DNS.

## Deploying from GitHub (optional)
`.github/workflows/ci.yml` runs the tests on every push. To also deploy on `main`, add a repo secret `CLOUDFLARE_API_TOKEN` (template: "Edit Cloudflare Workers") and this step:
```yaml
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```
Alternatively, connect the repo in the Cloudflare dashboard (Workers Builds, also free).
