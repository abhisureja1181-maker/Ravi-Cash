# Ravi Cash — Cash Voucher & Cash Register Management

**RAVI WATER FLOW PUMP** · cash payment vouchers (CPV-000001) and cash receipts (CRV-000001), a cash register for
every user, statements, PDFs, exports, branch monitoring, live sync between phones and computers.

One code base gives you:

| What | How |
|---|---|
| Web app (desktop, tablet, phone) | open the server address in any browser |
| Android app | open the same address in Chrome → menu → **Install app** (it is a PWA: own icon, full screen, works offline) |
| One live backend for every device | `server/` — a small Node.js server, **no npm packages needed** |
| Try it with no server at all | open `app/index.html` through any static web server — **demo mode**, data stays inside that browser only |
| Database foundation for Supabase / PostgreSQL | `supabase/` — tables, row-level security, SQL functions, storage rules (see "What is and isn't finished") |

---

## 1. Quick start

Needs **Node.js 20 or newer** (free, from https://nodejs.org — choose the *LTS* version). Nothing else to install.

**Windows, no typing:** unzip the folder, then double-click **`START-DEMO.bat`** (demo data) or **`START.bat`** (your own
empty system). Keep the black window open, and open **http://localhost:8080** in Chrome. Close the window to stop.
*(The .bat files could not be tested on a real Windows PC here; the same commands below were tested on Linux.)*

**Any system, from a terminal opened in the project folder:**

```bash
# a) try it with ready-made demo data (3 branches, 8 users, ~600 vouchers)
npm run start:demo        # http://localhost:8080   (data in ./data-demo)  — Windows, macOS, Linux

# b) real use — an empty database, you create your own company on first start
npm start                 # http://localhost:8080   (data in ./data)
```

On the very first start of `npm start` the login page becomes a **one-time setup screen**: enter the company/branch
name, branch code and the Super Admin's name, username and password. After that the screen is gone for good —
nobody can register themselves; the Super Admin creates every branch and user inside the app.

### Demo logins (`npm run start:demo` and plain demo mode)

| Branch | Username | Password | Role |
|---|---|---|---|
| MAIN | `admin` | `Admin@1234` | Super Admin (all branches) |
| MAIN | `ceo` | `Ravi@1234` | CEO (sees every branch, changes nothing; can sign in from any branch) |
| MAIN | `main.manager` | `Ravi@1234` | Branch Admin |
| MAIN | `main.accountant` | `Ravi@1234` | User |
| INDORE | `indore.manager` | `Ravi@1234` | Branch Admin |
| INDORE | `indore.accountant`, `neha.joshi` | `Ravi@1234` | User |
| NAGPUR | `nagpur.accountant` | `Ravi@1234` | User |
| NAGPUR | `nagpur.auditor` | `Ravi@1234` | Viewer (read-only) |

Change or delete these before real use (Admin → Users). In real use (`npm start`) these accounts do not exist.

---

## 2. Roles

| Role | Can do |
|---|---|
| **SUPER_ADMIN** (the "main admin") | the **only** role that changes anything: edit / void / delete vouchers, **change a voucher number**, remove attachments, audit review (Valid / Not valid / Undo), opening balances, create / edit / suspend / reset users, outstanding entries (add / edit / settle / cancel / delete), branches, settings, danger zone |
| **CEO** | **read-only, every branch**: the *CEO Dashboard* plus all vouchers, users, cash registers, outstanding, audit log, reports and exports. Can sign in through any branch, has no cash register, cannot create or change anything (no buttons, and the server refuses it too). Made by the main admin: *Users → Add User → Role → CEO* |
| **BRANCH_ADMIN** | **read-only** for own branch: sees vouchers, users, cash registers, outstanding, audit log, reports and exports; can create their own vouchers. Cannot edit, void, delete, renumber, review, or manage users / outstanding / opening balances (no buttons, and the server refuses it too) |
| **USER** | create vouchers/receipts, own cash register, own statements and PDFs; plan own tours and record own meetings. Cannot edit a saved voucher |
| **VIEWER** | read-only view of own branch (tours too) |

Tours (see *Feature map*): **every role that can create vouchers** (User, Branch Admin, main admin) keeps its own tour plans and meetings; the CEO, Viewer and everybody else only read. A User sees own tours, a Branch Admin / Viewer the branch, the CEO and the main admin every branch.

Live location (see *Feature map*): **only the main admin and the CEO** can see the Live Map and where a meeting was recorded. Only Users and Branch Admins are tracked; the main admin, CEO and Viewer are not.

Rules the server enforces (not only the screen): branch isolation; vouchers are **locked after saving**; only the main
(Super) admin can correct them — and an admin
change always needs a **reason** and writes an **audit entry with old and new values** (entries are hash-chained, so
tampering is detectable — Admin → Audit → *Verify chain*); voucher numbers are assigned **by the server, atomically,
never reused** (void/delete keeps the number; the main admin can still *correct* a number — it must be unique, 3-30 characters of
letters / digits / - / _, the old and new number go into the audit log, and automatic numbering skips any number that was typed in by hand); login lock-out after repeated wrong passwords; disabled
users/branches lose access immediately.

## 3. Feature map

* **Company logo** — the Ravi water flow PUMP logo (`app/img/logo.jpg`, `logo-mark.jpg`) is on the voucher (screen, print and PDF), on every statement / report PDF,
  on the sign-in page, in the menu and in the phone-app icon. To change it, replace those two files (white background, JPEG) and the icons in `app/icons/`.
* **Branch-wise books and the branch's own sign-in** (new in 5.3):
  * **Dashboard of the main admin / CEO** — a row of buttons *Main · Indore · Nagpur · … · All together* chooses whose books are shown. The cards, the charts, the recent vouchers and the outstanding total then belong to
    **that branch only** (Main shows only the Main branch's cash — the other branches are no longer mixed in). The choice is remembered on that device. *All together* is the whole company.
  * **Branch-wise accounts** — under the cards, every branch is its own block (cash in, cash out, net, balance) and below it **each user's own account** (cash register id, cash in / out / balance for the chosen period).
    A *Company total* line closes the list; the branch blocks always add up to it. Entries of users who were later removed are shown as one "Removed users" line so nothing is hidden. Click a branch to open only its books; a user to open
    the activity report. A Branch Admin sees the same for their own branch only. The first branch ever created is the **Main** branch.
  * **Add Branch creates the branch's sign-in too** — the form asks for the branch admin's name, a username and (optionally) a password; empty = one is generated and shown once. The branch and its login are created together
    (if the username is taken or the password is weak nothing is created). The branch admin signs in with the **branch code + that username + that password**, must choose a new password at first sign-in, and sees only
    their own branch. Email and mobile are optional for this login. More users can be added to the branch later from *Users*.
* **Tours** (`#/tours`; in the menu for everybody, in the bottom bar of the phone app for Users) — two parts:
  * **Tour Plan (advance plan)** — for a tour of any length (up to 60 days) choose the from / to dates; the app opens one card per day. For each day write the **place(s)** and the **parties you will meet**
    (party name, address, phone, purpose). Tick *No visit this day* for a rest day. Parties met before are suggested while typing and fill their own address / phone.
  * **Tour Details (meetings)** — during the tour tap **Record Meeting**: date, time, **party name, address, phone**, contact person, notes and **photos** (live camera with Preview / Retake / Use Photo, or the gallery; up to 4,
    compressed automatically). Pick a planned party and its details are filled in; a party that was not in the plan can be added too.
  * **Approval — the plan goes to the main admin.** A new plan is saved as *Awaiting approval* and the main admin is notified. Until it is approved **only the main admin can change it** (Edit plan); the person who made it cannot.
    When the main admin taps **Approve plan** the plan is **final** — nobody can change it any more, not even the admin. After that the person who made the tour can only **Cancel tour** (reason needed; the admin is told) or mark it
    completed when it is over, and keep recording meetings. Reopen and Delete are the main admin's. The admin's own plans need approval too; plans saved before this version count as approved. The dashboard of the main admin and the
    CEO Dashboard show how many plans are waiting (`#/tours?approval=1`).
  * The **tour page** shows the plan day by day with each planned party marked *Met / To meet / Not met*, the recorded meetings under their day, and a summary (days, parties planned / met, meetings, photos).
    A tour can be marked *Completed* or *Cancelled* (reason needed); only the main admin can reopen it. Late meetings can still be added to a completed tour.
  * A person can **correct or delete their own meeting for 48 hours**; after that it is locked (only the main admin can change it, with a reason in the audit log), so the field record cannot be rewritten later.
    Everything is in the audit trail (entities TOUR and VISIT); the main admin gets a notification for each new plan (and the owner for every approval or admin change).
  * Dashboards: a User sees a *You are on tour* strip with a Record Meeting button; the CEO Dashboard has a **Field tours** card (who is on tour today, tours starting in the next 14 days, meetings / parties / photos in the period).
  * Deleting a user, a branch or "Reset entire system" takes their tours, meetings and photos with it; "Clear all transactions" leaves tours alone. Meetings need an internet connection (unlike vouchers there is no offline queue yet) — if the
    connection is lost the form stays open with everything typed, ready to save again.
* **Live location and Live Map** (`#/live-map`; only the main admin and the CEO — the server refuses everybody else) — where the field staff are and what they are doing:
  * **The map** shows every Branch Admin and User with a coloured marker: *Live* (position under 3 minutes old), *Recent* (under 30 minutes), *Offline*, *Location off* (they said no, or the phone blocks it) or *Not shared yet*. A side list can be filtered by
    branch, person and status; tap a person to see their **route for the day** (a line with the distance), the **meetings recorded that day as numbered pins** (party, time, place) and what they are doing now (on tour, last meeting, last voucher).
    It refreshes by itself. A date picker shows an earlier day's route (kept for 30 days).
  * **Tour meetings** — when someone taps *Record Meeting* the phone adds the place (latitude / longitude, accuracy, time) to the meeting. On the **tour page** a map card shows every place of the tour, and each meeting card has *View on map*
    (with *Open in Google Maps*). A meeting can still be saved without a place (location off, blocked, no GPS) — the reason is stored and shown. The **owner and the Branch Admin only see that a place was saved**; the coordinates are for the main admin and the CEO.
  * **Fairness and privacy** — the first time, the person gets a plain notice (what is shared, who sees it, how long) and answers *Allow* or *Not now*; the browser then asks for its own permission. A **"Location on"** sign stays at the top of the phone while it is shared, and
    *Not now* or a blocked permission is not hidden: the admin sees "Location off". Positions are kept for **30 days** (7–90, *Settings → Live location*), where the main admin can also switch the whole feature **off**. Deleting a user, a branch or *Reset entire system* erases their locations too.
  * **Limits to know** — it is a web app, so it can only send the position **while the app is open and signed in** (about once a minute, sooner after moving 150 m); it cannot track a closed or locked phone — that needs a native Android app. A phone's GPS can be faked with a "mock location" app; the accuracy of each position is stored and a stale one is flagged.
    The street background comes from OpenStreetMap and **needs internet** (the markers and routes stay correct without it, and a notice says so); OpenStreetMap's free servers are for light use only — for heavy use set your own tile server with `MAP_TILE_URL`. The map library (Leaflet 1.9.4, BSD-2) is shipped inside the app (`app/vendor/leaflet`).
  * **Phone hardening (5.3)** — the app retries by itself when the first call after sign-in fails on a weak network (the chip shows *Connecting…*); an "Allow" answer that did not reach the server is sent again and also
    travels with the first position; the position is sent the moment the person leaves the app (another app, lock screen), so the admin sees where they were when it went quiet; the notice is shown only **after** the first
    password change. The **Profile** page of Users and Branch Admins has a *Live location* card: status, phone permission, when the last position reached the company, any error, a **Send my location now** button, and an optional
    *Keep the screen on while the app is open* switch (uses more battery, helps during a tour). On the Live Map an *Offline* person is one whose app is closed or phone is off / out of signal.
  * Positions are stored outside the main database file (`loc`, `trail:<date>`), so a ping every minute does not rewrite the data or wake every screen. In `Ravi-Cash-DEMO.html` the map shows sample staff; real tracking across phones needs the server.
* **CEO Dashboard** (`#/ceo`; the CEO's home page, also open to the main admin) — one page for the whole company: *Needs your attention* (negative cash registers, overdue money, payments
  waiting for review, large payments, Not valid payments, branches silent today, staff silent 7+ days, failed sign-ins, corrections by the main admin), company cash in hand, cash in / out / net with the
  change against the previous period, every branch side by side (tap for its analytics), trend charts, branch share, biggest payees, who spent / holds the most, and a live activity feed.
  Today / This Week / This Month / This Year / All Time; refreshes by itself when anything changes.
* **Voucher** — Cash Payment / Cash Receipt, amount in words (Indian numbering), PDF with the voucher on page 1 and
  the attached receipt/photo on page 2+. The voucher is always white, in dark mode too.
* **Audit review (Valid / Not valid)** — *Audit → Voucher review* lists every payment voucher; **only the main (Super) admin**
  checks the bill and marks it **Valid** or **Not valid** (reason required for Not valid; the same buttons are on the voucher page).
  Branch users and Branch Admins see the result and the reason on the voucher but have no buttons (the server refuses them too). A voucher marked **Not valid** stays on record, is stamped NOT VALID, but its
  amount is **not counted as an expense** anywhere — cash balance, registers, statements, dashboards, reports, exports —
  so the money is back in the user's cash. Decisions are reversible (Mark valid / Undo) and each one is written to the
  audit log (who, when, why); the user is notified. Until someone reviews it, a payment is counted (status "To review").
  Editing a voucher that was already marked Valid sends it back to "To review". Only payments are reviewed.
* **Cash Received** — when a user is handed money (e.g. the owner gives cash for expenses) they create a *Cash Received*
  entry (**Cash Received** button on the dashboard / My Vouchers, or the third choice on the Create Voucher screen).
  Same form and PDF, but **no voucher number** (and no number from the voucher counters is used). It adds to that user's
  cash balance, so *Cash Register* shows what each user holds (with a "Cash received" column). The main admin can void or erase it
  like any entry.
* **Receipt photos** — take a photo with the phone camera or pick a file; compressed on the device.
* **Cash register** — opening + receipts − payments = closing, running balance after every entry.
* **Statements** — daily / weekly / monthly / yearly / custom, with a user identity block; PDF download.
* **Admin** — dashboard, branch monitoring, user-wise and branch-wise reports, outstanding, notifications,
  global search, **export to CSV / Excel / PDF** with filters (voided and *Not valid* vouchers keep their amount on the row but never count in cash totals; exports carry an *Audit review* column).
* **Deleting data** (Super Admin; everything asks for a reason and is written to the audit log):
  * **Delete** on a voucher keeps it on record, hidden from lists (visible to admins under *Deleted*).
  * **Delete permanently** erases for good: a voucher (detail page, or tick several in *All Vouchers*), an outstanding entry
    (Super Admin only), a user *with* all their vouchers and register (Users → Manage → Delete user → tick
    "Also erase everything they created"), or a whole branch with its users and data (Branches → Delete, type the branch code).
    Only a short record of what was erased stays in the audit log. Voucher numbers are not reused after a single erase.
  * **Several at once.** *Users:* tick the users (the tick-boxes also show on phones) → **Delete selected** — by default they can no longer
    sign in and their vouchers stay on record; tick "Also erase everything they created" to remove their vouchers, photos and
    registers too (up to 200 users per action; you cannot include yourself or the last active Super Admin; all-or-nothing).
    *Vouchers:* in *All Vouchers* tick the page, then **Select all N matching these filters (all pages)** → **Delete all N permanently** — it
    removes every voucher that matches the current filters, not only those on screen (the count is re-checked on the server; you
    type `DELETE ALL` and give a reason; above 500 vouchers one summary line goes to the audit log instead of one per voucher).
  * **Settings → Danger zone** — *Clear all transactions* (every voucher, photo, statement, outstanding entry and
    notification; branches/users/settings stay; optionally restart numbering at 000001, zero the opening balances, erase the
    audit history) and *Reset entire system* (back to the first-time setup screen; in demo mode: fresh sample data).
    Both need your password and typing `DELETE ALL`. On the Node server a full backup copy (database + receipt photos) is
    saved first in `data/backups/before-clear-<time>/`; if that backup fails, nothing is deleted. Five wrong passwords lock the action for 5 minutes.
* **Offline** — with no network the voucher is kept on the device as **"OFFLINE — WAITING FOR SYNC"** (no number yet);
  when the network is back the server assigns the real number. Retrying never creates a duplicate.
* **Live sync** — a voucher saved on one device appears on the others within about a second (server-sent events).
* **Look** — navy + orange, light by default with a dark mode switch, bottom navigation and a floating "+" button on phones,
  sidebar for admins.

---

## 4. Running it for real

### Data and backups
Everything is stored in `DATA_DIR` (default `./data`): the database file, the receipt photos (`kv/`) and a `backups/` folder
(rotating hourly copies, plus a `before-clear-…` folder every time someone uses *Clear all data* — delete those yourself when you no longer need them).
Writes are atomic (temp file + fsync + rename) and a lock file stops a second server from using the same folder.
**Back up by copying the folder** (or just `backups/`) to another disk or cloud storage regularly.
Restore = stop the server, put the files back, start it.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | where to listen |
| `DATA_DIR` | `./data` | where the data lives |
| `TRUST_PROXY=1` | off | read the client IP from `X-Forwarded-For` — **only** when behind your own reverse proxy |
| `PUBLIC_HTTPS=1` | off | send HSTS — when the site is served over HTTPS |
| `CORS_ORIGIN` | – | allow a separately hosted front-end |
| `PBKDF2_ITERATIONS` | `310000` | password-hash cost |
| `SETUP_KEY` | – | online hosting: the first-time setup screen asks for this key, so nobody else can claim a fresh server |
| `RUN_AS_UID` | – | start as root, fix the data folder's owner, then continue as this user (set by the `Dockerfile`; hosts mount disks as root) |
| `MAP_TILE_URL` | OpenStreetMap | street-map background for the Live Map, e.g. `https://tiles.example.com/{z}/{x}/{y}.png` (its host is added to the page's image policy automatically) |
| `SEED_DEMO=1` | off | fill an **empty** data folder with demo data (never touches existing data) |

### If the login screen says "Cannot reach the server"
The installed app can open from the browser's saved copy even when the server is off. Start `START.bat` (on the computer that
hosts the data) and keep its black window open — the login screen reconnects by itself within a few seconds. If the server runs
elsewhere, check that computer / the internet connection.

### Just want to look at it? `Ravi-Cash-DEMO.html`
One single file with the whole app in demo mode: double-click it on a PC, or open it on a phone / in the Claude app — no server, no internet.
It has sample data, kept only inside that browser on that device (in a locked-down preview it lives in memory until the page closes), so it is for
looking and trying, **not** for real records and **not** shared between devices. Rebuild it with `npm run single`. Real shared use needs the server (below).

### Using it on a phone, and from anywhere
`http://localhost:8080` only works **on the computer that runs the server** — on a phone "localhost" means the phone itself.
Three ways, from simplest to proper:

1. **Same Wi-Fi (quick test):** start `START.bat`; the console prints `phone on the same Wi-Fi: http://192.168.x.x:8080`.
   Open that address on the phone. Allow Node.js in the Windows Firewall when asked (private networks). Vouchers and the
   native camera work; *Install app* and offline mode do not (they need HTTPS).
2. **Anywhere, from your own PC (temporary):** a tunnel such as Cloudflare Tunnel (`cloudflared tunnel --url http://localhost:8080`)
   gives a public `https://…` link to the PC. The PC and `START.bat` must stay on, and the quick-tunnel link changes every
   time. Good for a demo to someone, not for daily use. *(Not tested here.)*
3. **Online for real.** Easiest, no Linux needed: [`EASY-ONLINE.md`](EASY-ONLINE.md) (Hinglish; `render.yaml` Blueprint for Render, about $7–8 a month with a
   persistent disk). On Google Cloud's free-tier VM (about $3.65 a month, mostly the public IPv4 address): [`GOOGLE-CLOUD-GUIDE.md`](GOOGLE-CLOUD-GUIDE.md) (one command: `deploy/gcp-setup.sh`; weekly `deploy/backup.sh`). With your own VPS and domain: [`ONLINE-GUIDE.md`](ONLINE-GUIDE.md) (`docker-compose.yml` + `deploy/Caddyfile`).
   *The Dockerfile was built and run in a real container here (data-disk ownership, restart, setup key); Caddy/HTTPS, Render and Google Cloud themselves were not.*: run the server on a small always-on cloud server (a VPS, or a host with a **persistent disk** —
   the data folder must survive restarts, so serverless hosts like Vercel/Netlify do not work) behind HTTPS with a domain
   name, as in the next section. Then every phone, and the admin, opens the same `https://` address from anywhere, and the
   app can be installed on the phone's home screen. Back up `DATA_DIR` regularly.

### HTTPS (required for phones)
Browsers only allow the camera, "Install app" and offline mode on **HTTPS** (or `localhost`). Put the server behind a
reverse proxy that handles the certificate. Example with Caddy (*untested here — adjust to your setup*):

```
ravicash.example.com {
    reverse_proxy 127.0.0.1:8080 {
        flush_interval -1        # keeps the live-sync stream flowing
    }
}
```
and start the app with `TRUST_PROXY=1 PUBLIC_HTTPS=1 npm start`.

### Keep it running
Example systemd unit (*untested here*):

```ini
[Unit]
Description=Ravi Cash
After=network.target
[Service]
WorkingDirectory=/opt/ravi-cash
Environment=PORT=8080 HOST=127.0.0.1 TRUST_PROXY=1 PUBLIC_HTTPS=1 DATA_DIR=/var/lib/ravi-cash
ExecStart=/usr/bin/node tools/build.js
ExecStart=/usr/bin/node server/index.js
Restart=always
User=ravicash
[Install]
WantedBy=multi-user.target
```
(If systemd refuses two `ExecStart=` lines, run `npm run build` once and keep only the second.)

### Updating
Copy the new files over, run `npm run build` (this stamps a new version so installed phones fetch the update), restart.

---

## 5. Tests

```bash
npm test          # 93 tests: business rules, HTTP server, storage, exports, live location, static-app integrity
npm run test:db   # database tests on a throw-away local PostgreSQL (needs postgres 15/16 server binaries)
```

The business-rule tests cover numbering, voucher locking, admin corrections and audit, role/branch isolation,
register arithmetic, statements, idempotent offline sync, first-run setup, export totals, permanent deletion (single, several at once, by filter), the audit review, Cash Received entries, tour plans and meetings (rules, photos, 48-hour lock, approval, visibility, erase), live location (consent, who may see it, retention, erase, meeting places) and the setup key. The database tests run
the SQL layer (below) with 200+ checks and a concurrency run with hundreds of simultaneous vouchers.

## 6. Folder map

```
app/        the web app + PWA (plain JavaScript, no build step needed; works from any static host in demo mode)
  js/server-*.js   business rules (shared by the demo backend and the Node server)
  js/views/        screens
  js/tracker.js, map.js   live location on the phone, the Leaflet map helper (vendor/leaflet is the map library)
server/     Node server (HTTP JSON + live events + file storage)
supabase/   PostgreSQL schema, row-level security, functions, storage rules + tests
tools/      build.js (dist/ with version stamp), single-file.js (Ravi-Cash-DEMO.html), start-demo.js, icon and font generators
START.bat, START-DEMO.bat   double-click launchers for Windows
Ravi-Cash-DEMO.html         the whole app in demo mode as one file (double-click, no server)
tests/      node:test suites
```

---

## 7. What is and isn't finished — please read

* **Working end to end and tested:** the web app, Android PWA, Node server with multi-device live sync, offline outbox,
  PDFs, exports, admin tools, first-run setup.
* **Supabase / PostgreSQL:** `supabase/migrations` is a complete, tested database foundation (tables, RLS so clients
  can only read their scope, every write through checked SQL functions, atomic numbering, audit chain, private receipt
  storage with folder policies, realtime). It is **not connected to the screens yet**: there is no `supabaseAdapter` in
  the app, the dashboards/reports/search/export queries are not ported to SQL, and users must be created through the
  Supabase Auth admin API + `rw_provision_user`. Use the Node server for a working system today; treat the SQL as the
  starting point for a hosted version. The permanent-delete, *Clear all data*, audit review (Valid / Not valid) and *Cash Received* functions exist in the Node server only; they are not in the SQL layer.
* **Live location is web-based:** it works while the app is open (see *Live location and Live Map* for the limits). Tracking a closed or locked phone, and a guarantee against faked GPS, need a native Android app. Not tested on real phones — checked in a desktop browser with a simulated GPS, at desktop and phone size.
* **Demo mode** keeps data in that browser only. It is for trying the screens, not for real records.
* **"Block negative cash"** (Settings) is **off by default**: a user can pay out more than the register holds, as
  that is how many shops work. Turn it on if you want the server to refuse such payments.
* **Not tested here:** Docker, Render, the HTTPS/Caddy/systemd examples above, real Android devices (the PWA was verified in a
  desktop browser at phone size), and Safari/iOS.
* **Branding:** the voucher layout was rebuilt from the written description. The reference voucher image, the logo
  and the login video were not available, so the logo is a placeholder wordmark and the login animation is built in
  code. Send those files and the voucher can be matched exactly.
* **Single server:** the file storage is meant for one server process and one company (a few hundred thousand
  vouchers is comfortable). For many companies or high availability, use the PostgreSQL route.
* **Password reset:** there is no e-mail sending. "Forgot password" tells the user to ask their admin, who sets a
  temporary password (user must change it at next sign-in).
