# Ravi Cash ko online karna — sabse aasan raasta (Render)

Kyun chahiye: abhi app sirf aapke PC par chalti hai (`localhost:8080`). Phone par "localhost" ka matlab phone khud hota hai, isliye
wahan khulti nahi. Staff ko **kahin se bhi** (ghar, dukaan, bahar, mobile data) login karna hai, to app ko ek **online `https://` link** par
chalana padega. Ek baar ho gaya to:

* staff apne Android phone ke Chrome me link kholega → login → menu (⋮) → **Install app / Add to Home screen** → phone me normal app ki tarah chalegi,
* aap (admin) PC ya phone se wahi link khol kar sab dekh sakte hain, aur voucher live sync hote hain,
* PC band ho tab bhi chalta rahega.

> **Dhyan (honest note):** ye Render wali files maine yahan test nahi kiye (mere paas Render/Docker nahi hai). App ka server maine
> usi tarah chala kar dekha hai (disk root ke naam par ho tab bhi chalta hai, Setup key kaam karti hai), par pehli deploy me koi chhoti
> dikkat aa sakti hai. Error ka screenshot/text bhej dijiye, main theek kar dunga.

> **Sirf dekhna/try karna ho:** `Ravi-Cash-DEMO.html` ek hi file hai — PC par double-click, ya phone me kholein. Server nahi chahiye, par wo demo hai: sample data,
> sirf usi phone/browser me, aur doosre phones se share nahi hota. Asli kaam ke liye neeche wala online link chahiye.

## Kharcha
Render par disk (permanent storage) **sirf paid instance** par milti hai (free par nahi). Maine jab dekha: sabse chhota paid instance
**$7 / mahina** + disk **$0.25 per GB / mahina** (1 GB kaafi hai shuru ke liye) = lagbhag **$7.25 mahina** (rupaye me rate badalta rehta hai,
tax alag ho sakta hai). Pakka rate Render ki pricing page par dekh lein: https://render.com/pricing.
Card (debit/credit) chahiye. **Free hosting (Vercel/Netlify/free Render) nahi chalegi** — usme data permanent save nahi rehta.

## Steps (lagbhag 20–30 minute, ek hi baar)

### 1) Files ko GitHub par rakhein
Render aapki files GitHub se uthata hai.
1. https://github.com par free account banayein.
2. Upar **+ → New repository** → naam `ravi-cash` → **Private** chunein → *Create repository*.
3. Naye page par **"uploading an existing file"** link dabayein.
4. Meri di hui **`ravi-cash-online-upload.zip`** ko PC par *Extract* karein. Extract hue folder ke **andar ki sab cheezein** (`Dockerfile`, `render.yaml`,
   `package.json`, folders `app`, `server`, `tools`) select karke browser ke us page par **drag & drop** karein (Chrome ya Edge me folders bhi chhod sakte hain).
5. Neeche **Commit changes** dabayein.

### 2) Render par chalayein
1. https://render.com par **Sign up with GitHub** (usi account se).
2. **New + → Blueprint** → apna `ravi-cash` repository chunein → **Connect**.
3. Render `render.yaml` padhega aur dikhayega: ek web service `ravi-cash` + disk `ravi-data`. **Apply** dabayein. Payment card maange to daalein.
4. 5–10 minute baad service ke naam ke neeche **Live** dikhega. Upar uska link hoga, jaise `https://ravi-cash-xxxx.onrender.com` — yahi aapka app ka link hai.
   (Upar link par click karke ya copy karke apne paas save kar lein.)

### 3) Pehli baar setup (sirf aap)
1. Render me `ravi-cash` service kholein → left menu **Environment** → `SETUP_KEY` ke saamne **eye/Reveal** dabayein → value **copy** karein.
2. App ka link kholein. **Set up your system** screen aayegi. **Setup key** wale box me wo value paste karein, baaki apna business naam, pehli branch,
   aur apna naam / username / password (Super Admin) bharein → *Create system*.
   (Ye key isliye hai ki link jaante hi koi ajnabi aap se pehle setup na kar sake.)
3. Ab **Branches** me baaki branches banayein, **Users** me staff ke ID-password banayein.

> PC par `START.bat` wala purana data online wale system me **nahi** aata — online par naya khaali system banta hai. (Zaroorat ho to bataiye, purana data
> import karne ka raasta dekhenge.)

### 4) Staff ko kya bhejna hai
Sirf ye 4 cheezein: **link**, **Branch**, **Username**, **Password**.
Android phone par:
1. **Chrome** kholein, link daalein (WhatsApp me link par tap bhi chalega).
2. Branch chunein, username/password se login → pehli baar naya password chunna padega.
3. Chrome ka menu **⋮ → Install app** (ya **Add to Home screen**). Phone me "Ravi Cash" ka icon aa jayega.
4. Ab kahin se bhi, wifi ya mobile data par, icon dabake login karein.

## Roz ka kaam / dhyan rakhne ki baatein
* **Update lagana:** naya `ravi-cash-online-upload.zip` extract karke GitHub repo me wahi files dobara upload karein (Add file → Upload files, same naam overwrite ho jayenge)
  → Render apne aap naya version chala dega (kuch second ka break aata hai). Data surakshit rehta hai.
* **Backup:** Render disk ka snapshot roz apne aap leta hai aur kam se kam 7 din rakhta hai (Render ki docs ke hisaab se). Uske upar apni taraf se
  hafte me ek baar *All Vouchers → Excel / CSV* export karke PC par rakhein. App `data/backups` me bhi apni copy rakhti hai (wo bhi usi disk par hoti hai).
* **Dikkat:** Render me service → **Logs** dekhein; aur error text mujhe bhej dein.
* **Password:** Super Admin ka password kisi ko na dein; staff ko sirf unka apna User account.

## Agar abhi sirf turant dikhana ho (free, temporary)
PC par `START.bat` chalu rakhein aur Cloudflare ka quick tunnel use karein (`cloudflared tunnel --url http://localhost:8080`) — ye ek public `https://…` link
deta hai jo **jab tak PC chalu hai tab tak** kaam karta hai aur har baar badal jata hai. Sirf demo ke liye; roz ke kaam ke liye upar wala Render raasta lein.
(Ye maine yahan test nahi kiya.)

## Sasta raasta: Google Cloud ka free-tier server
Lagbhag $3.65/mahina (poora ₹0 nahi — public IP ka charge lagta hai), par thoda technical. [`GOOGLE-CLOUD-GUIDE.md`](GOOGLE-CLOUD-GUIDE.md) me step by step hai.

## Apna server (VPS + domain) chahiye to
[`ONLINE-GUIDE.md`](ONLINE-GUIDE.md) dekhein.
