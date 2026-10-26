# VoltShare: EV Charger Sharing Prototype (with backend)

Riders find nearby chargers, save a charging profile, send booking requests and
ask VoltBot, an assistant powered by the open-source **Gemma 4** model running
locally through **Ollama**.

## What is real and what is demo
- **Real:** accounts (hashed passwords), saved profiles, booking requests stored
  by the backend, 80/20 commission estimates calculated on the server, real
  charging stations from OpenStreetMap, AI answers from Gemma 4.
- **Demo:** the 6 host chargers are sample data. No host is notified, no money
  moves, and OpenStreetMap does not show live availability.

## Requirements
- Node.js 18 or newer (nodejs.org). No `npm install` needed: there are no packages.
- Optional, for the AI assistant: Ollama (ollama.com) and `ollama pull gemma4:e2b`.

## Run
1. Open a terminal in this folder.
2. Optional: copy `.env.example` to `.env` and set a long random `JWT_SECRET`.
3. `node server.js`
4. Open http://localhost:3000

Tests: `npm test`

## API (all JSON)
| Method and path | What it does | Login needed |
|---|---|---|
| GET /api/health | Server status | No |
| POST /api/auth/register | Create account (name, email, password 8+) | No |
| POST /api/auth/login | Log in, returns a token | No |
| GET /api/me, DELETE /api/me | Who am I / delete my account and data | Yes |
| GET, PUT, DELETE /api/profile | Saved rider profile | Yes |
| GET /api/chargers | Demo chargers (filters: connector, maxPrice, available) | No |
| POST /api/requests | Send a booking request (chargerId, hours 1-8) | Yes |
| GET /api/requests/mine | My requests | Yes |
| POST /api/requests/:id/cancel | Cancel my pending request | Yes |
| POST /api/chat | Ask VoltBot (Gemma 4 via Ollama) | Optional |

Security notes: passwords are hashed with scrypt, tokens are signed (HS256) and
expire after 7 days, price, status and commission sent by the browser are
ignored, users can only see and cancel their own requests, and requests are
rate limited. Data is saved in `data/db.json`.

## Manual test
1. Create an account, fill the profile, press Save and get advice.
2. Search a city to load real stations, then ask VoltBot for the nearest charger.
3. Press Request booking on an available demo charger, then check My booking requests and cancel it.
4. Stop Ollama and ask VoltBot again: it falls back to the built-in helper.

## Next steps
Real host accounts and listings, admin approval, time slots with overlap checks,
host accept/reject, reviews, a real database such as MongoDB, a payment sandbox,
and hosting the AI model on a server.
