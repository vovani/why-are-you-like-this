# Why Are You Like This?

A charades-style party game for phones. Two teams take turns: the actor sees a word, and their team has to guess it before the timer runs out. There are English and Hebrew decks.

It runs entirely on the Cloudflare **Workers Free** plan. Each room is a Durable Object that holds the game state and the players' WebSockets, so a game survives deploys and restarts.

## Run locally
```bash
npm install
npm run dev          # http://localhost:8787  (state persists in .wrangler/)
```
Open several tabs to play. Each tab counts as its own player, and reloading keeps your seat. To use the admin page at `/admin`, add the password to `.dev.vars`:
```
ADMIN_PASSWORD=dev
```

## Test
```bash
npm test
```
- Unit tests cover the game rules.
- End-to-end tests start `wrangler dev` (the production runtime) and connect up to 8 WebSocket players. They cover reconnects, stale sockets, double taps, host hand-off, the round timer, garbage input, permissions, admin, and a full restart in the middle of a game.

## Layout
- `lib/room.js`: game rules, timers, and presence rules. Pure and deterministic, with no I/O.
- `lib/cards.js`: the word decks.
- `worker/index.js`: Worker entry point. Handles routing, `POST /api/rooms`, `GET /ws?room=CODE`, and the admin API.
- `worker/game-room.js`: Durable Object, one per room. Uses hibernatable WebSockets and a single alarm for the round timer, host hand-off, dead-socket detection, and cleanup.
- `worker/directory.js`: singleton Durable Object for removed words, the room list for admin, and login throttling.
- `public/`: the client, served as static assets. It renders entirely from the latest `state` message.

## Deploy
See [docs/HOSTING.md](docs/HOSTING.md).
```bash
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npm run deploy
```
