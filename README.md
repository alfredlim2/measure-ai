# Measure.AI

Quantities from PDF construction drawings. People sign up, create a project, upload drawings, choose what to measure
(**Concrete & Formwork**, **Finishes** or **Steel Structure**), and get every item drawn on the sheet with its calculation,
a quantity table and a PDF report. Each measurement uses credits from the person's account.

Everything runs on one Node.js server with no extra packages: the web app (`web/`), the API, an SQLite database and
the files. The AI service key stays on the server; the browser never receives it, and no reply names the service or model.

**Features**
- Upload multi-page PDF sets; sheets are named and tagged automatically from their title blocks.
- Three measuring tools: concrete & formwork (columns, beams, slabs, walls, foundations, stairs), finishes (rooms,
  floor / wall / ceiling finishes, skirting, waterproofing, openings) and steel structure (members, lengths, connections).
- Every quantity is traceable: the item is drawn on the sheet, snapped to the PDF's own lines, with its calculation.
- Quantity tables, a "needs review" list and an annotated PDF report.
- Accounts (email + password or Google), projects, credits and an admin page.

## Requirements

- **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module). No `npm install` needed.
- An OpenAI-compatible API key for measuring (the site runs without one, but measuring is then switched off).

## Get the code

```
git clone https://github.com/alfredlim2/measure-ai.git
cd measure-ai
```

## Run it

1. Install **Node.js 22.5 or newer** (it has the built-in SQLite module).
2. Copy `.env.example` to `.env` and fill it in (at least `OPENAI_API_KEY` and `PUBLIC_URL`).
3. Start: `npm start` (or double-click **Start Measure.AI (Windows).bat**). Open the address it prints.
4. Sign up. **The first account becomes an administrator**; so do the emails listed in `ADMIN_EMAILS`.

Without an AI key the site still works (accounts, projects, upload, viewer) but the Measure button says measuring is not
available yet. With `AI_PROVIDER=mock` (or `"provider": "mock"` in `ai-settings.json`, which wins), sheet names are read from the PDF text layer only, at no cost.

## Settings (`.env`)

| Setting | What it does |
|---|---|
| `PUBLIC_URL` | The address people open, e.g. `https://app.measure.ai`. Used for Google sign-in and reset links. When it starts with `https://`, the session cookie is marked Secure. |
| `HOST`, `PORT` | Where the server listens (default `127.0.0.1:5173`). |
| `DATA_DIR` | Database (`measure.db`), uploaded drawings (`files/`) and saved runs (`runs/`). Default `./data`. **Back this folder up.** |
| `ADMIN_EMAILS` | Comma-separated emails that are administrators when they sign up. |
| `SIGNUP_CREDITS` | Free credits for every new account (default 0). |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google sign-in. Leave empty to hide the button. |
| `RESEND_API_KEY`, `MAIL_FROM` | Password-reset emails through Resend. Without a key the reset link is printed in the server console. |
| `CREDITS_PER_USD` | How many credits one US dollar of AI cost is charged as (default 100). |
| `MAX_UPLOAD_MB` | Largest PDF (default 150). |
| `MAX_RUNS_PER_USER` | Measurements one account can run at the same time (default 2). |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | The AI service. `ai-settings.json` (optional, same folder) wins over these. `AI_SETTINGS_FILE` points to another settings file (used for tests). |

### Google sign-in
In Google Cloud Console → APIs & Services → Credentials, create an **OAuth client ID** of type *Web application*.
Add the authorised redirect URI `<PUBLIC_URL>/auth/google/callback`, then put the client ID and secret in `.env`.
A Google account whose email already has a password account is linked to it.

## Accounts and credits

- **Sign-in:** email + password (scrypt hashes) or Google. Sessions are HttpOnly cookies, stored as hashes, valid 30 days.
  Every request that changes data must carry the app's own header, so other sites cannot post on a user's behalf.
  Sign-in, sign-up and reset requests are rate limited.
- **Password reset:** *Forgot password?* sends a one-hour, single-use link.
- **Account page:** name, password (or set one for a Google-only account), credit balance and credit history.
- **Credits:** before a run starts, the account must have credits; the run's spending cap is the balance. When the run
  ends (finished, stopped or failed) it is charged by what it actually cost, rounded up, never more than the balance.
  The run keeps everything found so far when credits run out.
- **Top up:** the *Top up credits* window is a placeholder ("coming soon") until online payment is added. Until then an
  administrator adds credits on the **Admin** page (Credits → amount and a note the user sees in their history).
  Payment will plug in at `credits.add(userId, amount, 'topup', paymentRef, note)` in `lib/credits.js`.
- **Admin page:** all accounts with balance, runs and last sign-in; add or remove credits; make someone an admin.

Each account sees only its own projects, drawings and runs: every query is filtered by the signed-in user.

## Test mode (for testing only)

Add `TEST_MODE=1` to `.env` and restart the server:
- **No sign-in:** everyone is one local account, "Test user" (`tester@local`, administrator). Login, sign-up, sign-out and Google sign-in are switched off.
- **No credits:** runs are neither checked against nor charged to credits. The top bar shows TEST MODE, the account and top-up pages are hidden, and the run box says "Test mode · no credits used".
- **The AI key is used directly:** the key from `ai-settings.json` / `.env`. Each run stops at `TEST_COST_CAP` dollars (default 10; `0` = no cap).
- **This computer only:** requests from other computers are refused unless `TEST_ALLOW_REMOTE=1`. Never use test mode on a public server.

Remove `TEST_MODE` (or set it to 0) and restart to return to accounts and credits. Nothing is deleted either way.

## Using the app

1. **Projects** → *New project*.
2. **Upload** PDFs (or drop them on the left list). A multi-page PDF opens a page picker. Sheets are named in the
   background from their title blocks (number, title, scale, type).
3. Tick the sheets to measure. Plans, sections, schedules and details can go together: they are read as one set.
4. Right panel → **Measure**: choose the tool and the items. *Whole sheet* / *Area set* limits a sheet to a box you drag.
   *More options*: faster (parallel parts), find rooms automatically (Finishes), use the PDF's lines.
5. **Results**: totals, items that need review, the quantity table and **PDF report**. Click any item on the drawing to
   see how it was measured and mark it as checked (saved with the run).
6. **History**: every run of the project, reopened on the drawings as they are now.

## How measuring works (short)

- The engine is fixed on the server: the planning round and re-checks think hard, continuation rounds and parallel
  parts think at a medium level. Nobody can choose or see the model.
- Round 1 plans the set; the rest runs in rounds (or parallel parts) until the answer says it is complete. Results
  stream in while the AI writes.
- The AI reports positions and what is printed; the app computes every length, area and volume, snaps positions to the
  PDF's own vector lines where they exist, and writes the calculation for each item.
- Finishes: rooms and door swings are found by the app from the PDF lines; the AI only names numbered rooms and their finishes.
- Every browser reply and event passes through `lib/brand.js`, which removes model names, service names, ids, cost and usage.

## Deploying publicly

- Run it behind a reverse proxy with HTTPS (Caddy, nginx), keep `HOST=127.0.0.1`, set `PUBLIC_URL` to the `https://` address.
- Keep `.env`, `ai-settings.json`, `data/` and `logs/` private (they are git-ignored).
- Back up `DATA_DIR` regularly; it is the whole state of the site.
- `logs/` holds the operator's own usage ledger and run logs (with costs); they are never served.

## Folder layout

```
server.js            HTTP server: API, job streams, static files
lib/                 auth, credits, db, mail, projects, brand (white label), takeoff engine, tool profiles (conc / finishes / steel)
web/index.html       the single page
web/app/             the interface: core, auth, viewer, document, run, workspace, projects, account, main, style.css
web/engine/          measuring engine used in the browser (geometry, PDF lines, rooms, builders per tool, PDF report)
web/vendor/          pdf.js, pdf-lib
web/sample/          sample drawings
```

## Third-party code

`web/vendor/` contains unmodified builds of [PDF.js](https://github.com/mozilla/pdf.js) 3.11.174 (Mozilla, Apache License 2.0)
and [pdf-lib](https://github.com/Hopding/pdf-lib) (MIT License); their license notices are kept in the files.

## License

No license has been chosen yet, so all rights are reserved by the author. Contact the owner of this repository before
using the code elsewhere.

## 快速开始（中文）

1. 安装 Node.js 22.5 或更新版本，然后 `git clone https://github.com/alfredlim2/measure-ai.git`。
2. 把 `.env.example` 复制为 `.env`，填写 `OPENAI_API_KEY` 和 `PUBLIC_URL`。
3. 运行 `npm start`，打开显示的地址。第一个注册的账号自动成为管理员。
4. 管理员在 **Admin** 页面为用户添加点数（在线充值以后再接入）。每次测量按实际用量扣点数。
