# linear-cli

Small Linear webhook demo:
- `src/webhook-server.ts` – Express server with webhook verification + SSE
- `public/widget.html` – Live event widget

## Setup
1. `npm install`
2. Copy `.env.example` → `.env` and fill values
3. `npx ts-node src/webhook-server.ts`
4. Open http://localhost:3000/widget.html

## Dev
- Test broadcast: `curl -X POST http://localhost:3000/dev/ping`
