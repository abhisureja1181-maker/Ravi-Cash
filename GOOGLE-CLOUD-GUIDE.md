# Ravi Cash ko Google Cloud ke free server par chalana — step by step

Is guide ke baad app ek `https://raviwater.duckdns.org` jaise link par chalegi (naam aap chunenge). Staff kahin se bhi, mobile data par bhi,
login karega aur PC + phones ka data live sync rahega.

## Pehle sach kharcha (zaroor padhein)
| Cheez | Kharcha |
|---|---|
| Server (e2-micro VM) | free tier me ₹0 — **sirf 3 US regions** me: `us-west1` (Oregon), `us-central1` (Iowa), `us-east1` (South Carolina) |
| Disk (30 GB) | ₹0 — **Standard persistent disk** chunna hai (console ka default "Balanced" paid hota hai, ~$3/mahina) |
| **Public IPv4 address** | **~$3.65 / mahina (~₹300)** — Google ek running VM ke public IPv4 par $0.005/ghanta leta hai; free tier me iski chhoot sirf 1 ghante ki hai |
| Data bahar jaana (egress) | pehle 1 GB/mahina free; uske baad lagbhag $0.12 per GB |
| Domain name (DuckDNS) | ₹0 |

**Matlab:** ye Render ($7.25) se sasta hai, par **poora ₹0 nahi** — lagbhag $3.65/mahina + tax. Shuru ke kuch mahine Google ka $300 free-trial credit ye kharcha dhak leta hai.
Google ka free tier "no end date" hai, par Google isko 30 din ke notice par badal sakta hai. Card (debit/credit) zaroori hai.
Server America me hai, isliye har click me thoda delay (lagbhag 0.3–1 second) lag sakta hai.

> **Dhyan:** ye maine asli Google Cloud par nahi chalaya (mere paas aapka account/server nahi). App ka container, data-disk ki permission aur restart ke baad data
> bachna maine Docker me test kiya hai. HTTPS (Caddy) wala hissa aur Google ke console ke steps test nahi hue; Google console ke naam kabhi-kabhi badal jaate hain.
> Kahin atak jayein to screenshot bhej dijiye.

---

## Step 1 — Google Cloud account
1. https://console.cloud.google.com kholein, apne Google account se login karein.
2. Terms accept karein. **Free trial / Activate** dabayein — country India, account type Individual (ya Business), card ki details (verification ke liye; free limit ke andar paisa nahi katta).
3. Trial ke baad Google **Upgrade** karne ko kahega. Upgrade nahi karenge to trial ke resources band ho jaate hain aur 30 din baad delete — isliye trial khatam hone se pehle **Upgrade** kar dein
   (Free tier upgrade ke baad bhi rehta hai; sirf limit se upar ka use bill hota hai).

## Step 2 — Project banayein
Upar bar me project ka naam → **New Project** → naam `ravi-cash` → **Create**. Phir wahi project chunein.

## Step 3 — Compute Engine chalu karein
Left menu (☰) → **Compute Engine** → **VM instances**. Pehli baar "Enable" ka button aayega — dabayein aur 1–2 minute ruken.

## Step 4 — Server (VM) banayein
**Create instance** dabayein aur ye bharein:
* **Name:** `ravi-cash`
* **Region:** `us-central1 (Iowa)` (ya `us-west1` / `us-east1`) — **in teen ke bahar free nahi hai.** Zone: koi bhi.
* **Machine configuration:** Series **E2**, Machine type **e2-micro** (2 vCPU, 1 GB memory).
* **OS and storage → Change:**
  * Operating system: **Ubuntu**, Version: **Ubuntu 24.04 LTS** (x86/64)
  * **Boot disk type: Standard persistent disk** ← zaroori
  * Size: **30 GB** → Select
* **Networking / Firewall:** ✔ **Allow HTTP traffic**, ✔ **Allow HTTPS traffic**
* **Advanced options → Networking → Network interfaces → default → External IPv4 address:** dropdown me **Create IP address** → naam `ravi-ip` → **Reserve**.
  (Isse IP kabhi nahi badalta. Kharcha wahi $3.65 hai, jab tak IP VM se juda hai.)
* Console ke right side ka "monthly estimate" free tier ko poora nahi dikhata, isliye wo ~$7 jaisa dikha sakta hai — asli bill baad me **Billing → Reports** me dekhein (Step 11).

**Create** dabayein. 1 minute me VM list me green tick aa jayega. **External IP** wale column me ek number hoga (jaise `34.12.56.78`) — use copy kar lein.

## Step 5 — Free naam (DuckDNS) banayein
Bina naam ke HTTPS (padlock) nahi ban sakta, aur bina HTTPS ke phone me "Install app" nahi chalta.
1. https://www.duckdns.org kholein → **Sign in with Google**.
2. "domains" ke box me apna naam likhein (jaise `raviwater`) → **add domain**.
3. Us naam ke saamne **current ip** me VM ka External IP paste karein → **update ip**.
4. Apna link ab `raviwater.duckdns.org` hai. 2 minute baad PC par PowerShell me check karein: `nslookup raviwater.duckdns.org` — jawab me wahi IP dikhna chahiye.

## Step 6 — Server se connect karein (browser me hi)
VM instances list me `ravi-cash` ki row me **SSH** button dabayein. Popup me **Authorize** karein. Ek kali terminal window khulegi — yahi aapka server hai.

## Step 7 — App ki zip upload karein
Terminal window ke upar-right me **⚙ (gear) → Upload file** → apne PC se **`ravi-cash-v5.4.zip`** (poori zip, "online-upload" wali nahi) chunein.
Wo server ke home folder me aa jati hai.

## Step 8 — Ek command se chalu karein
Terminal me ye lines ek-ek karke paste karein (Enter dabayein). `raviwater.duckdns.org` ki jagah apna naam likhein.

```
sudo apt-get update && sudo apt-get install -y unzip
unzip -o ravi-cash-v5.4.zip
cd ravi-cash
sudo bash deploy/gcp-setup.sh raviwater.duckdns.org
```

Ye apne aap: 1 GB swap jodta hai, Docker lagata hai, app banata hai aur chalu karta hai. Pehli baar **3–6 minute** lagte hain (kuch der kuch print nahi hota to ghabrayein nahi).
Agar script kahe ki "naam abhi is server ke IP par nahi point kar raha" to Step 5 dobara dekhein, 2 minute ruk kar wahi command dubara chalayein.

End me ye aayega:
```
Ravi Cash is running.
Open:        https://raviwater.duckdns.org
SETUP KEY:   xxxxxxxxxxxxxxxxxxxxxxxx
```
**SETUP KEY copy kar lein** (wo server par `ravi-cash/.env` file me bhi rehti hai).

## Step 9 — Pehli baar setup (sirf aap)
1. Browser me `https://raviwater.duckdns.org` kholein. Pehli baar padlock banne me 1 minute lag sakta hai — error aaye to 1 minute baad refresh karein.
2. "Set up your system" screen par **Setup key** me wo key paste karein, baaki business ka naam, pehli branch, aur apna (Super Admin) naam / username / password bharein → **Create system**.
3. **Branches** me baaki branches, **Users** me staff ke ID-password banayein.

## Step 10 — Staff ko kaise dein
Sirf: **link**, **Branch**, **Username**, **Password**.
Android phone: Chrome me link kholein → login → (pehli baar naya password) → Chrome menu **⋮ → Install app / Add to Home screen**. Ab kahin se bhi, wifi ya mobile data par, icon dabake login.

## Step 11 — Kharche par nazar (5 minute, ek baar)
1. Menu (☰) → **Billing → Budgets & alerts → Create budget** → amount `$5` → email alerts 50% / 90% / 100% chalu rakhein. (Alert sirf email deta hai, kharcha apne aap nahi rokta.)
2. 3–4 din baad **Billing → Reports** dekhein. Theek hai agar sirf "External IP" jaisi chhoti line dikhe (~$0.12/din). Agar **"Compute Engine ... Persistent Disk (Balanced/SSD)"** ya **"Instance Core/RAM"** par paisa dikhe to disk type ya region galat chuna hai — mujhe bata dein.
3. VM ko **Stop / Delete mat karein** (Stop karne par reserved IP alag se mehnga pad sakta hai). Restart chahiye to terminal me `sudo reboot`.
   Agar kabhi VM delete karein to **VPC network → IP addresses** me jaakar `ravi-ip` ko **Release** karna na bhoolein.

## Roz ka kaam
* **Backup (hafte me ek baar):** SSH terminal me
  ```
  cd ravi-cash && sudo bash deploy/backup.sh
  ```
  Phir **⚙ → Download file** → `ravicash-backup-<tareekh>.tar.gz` chunein aur PC par rakhein. Saath me *All Vouchers → Excel/CSV* export bhi kabhi-kabhi karein.
* **Naya version lagana:** nayi zip **⚙ → Upload file** se bhejein, phir
  ```
  unzip -o ravi-cash-v5.4.zip      (jo naam ho)
  cd ravi-cash
  sudo docker compose up -d --build
  ```
  Data surakshit rehta hai (wo alag Docker volume me hai).
* **Dikkat dekhni ho:** `cd ravi-cash && sudo docker compose logs --tail 100 app` (ya `... caddy` HTTPS ke liye).
* **Band / dobara chalu:** `cd ravi-cash && sudo docker compose restart`. Server reboot par app apne aap chalu ho jati hai.

## Agar kuch na chale
| Dikkat | Kya karein |
|---|---|
| Browser "not secure" / certificate error | DuckDNS me IP sahi hai? `nslookup` se check karein. Ports 80/443 firewall me khule hone chahiye (Step 4 ke 2 tick). 1–2 minute ruk kar refresh. `sudo docker compose logs --tail 50 caddy` dekhein. |
| "Cannot reach the server" | `sudo docker compose ps` — dono (`app`, `caddy`) "running" hone chahiye. Nahi to `sudo docker compose up -d`. |
| Build beech me ruk jaye / "killed" | Memory kam padi: `free -h` me Swap ~1 GB dikhna chahiye. Script dobara chalayein. |
| Setup screen par "Wrong setup key" | Key `cat ravi-cash/.env` se dekhein (SETUP_KEY ki line). |
| Login me "password" bhool gaye | Super Admin ke liye mujhe bata dein; staff ka password Users page se reset hota hai. |

## Suraksha
* Google account ka password mazboot rakhein aur **2-Step Verification** chalu karein — is account se server aur uska poora data khulta hai.
* Super Admin ka password kisi ko na dein; staff ko sirf unka apna User account.
* SETUP_KEY kisi ko na dein (setup ke baad uski zaroorat nahi rehti).
