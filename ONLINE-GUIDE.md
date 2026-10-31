# Ravi Cash ko online karna (kahin se bhi chalane ke liye)

> **Sabse aasan raasta** (server/Linux ke bina) [`EASY-ONLINE.md`](EASY-ONLINE.md) me hai (Render par, mahine ke kuch sau rupaye). Google Cloud ke free-tier server (~$3.65/mahina) ke liye [`GOOGLE-CLOUD-GUIDE.md`](GOOGLE-CLOUD-GUIDE.md). Ye guide tab ke liye hai jab aap apna VPS + domain use karna chahein.

Is guide ke baad app ek `https://` link par chalegi (jaise `https://cash.aapkadomain.in`). Staff aur admin apne phone ya PC se
kahin se bhi usi link se login kar sakenge, aur phone par app install bhi hogi.

> **Dhyan:** ye files maine Docker ke bina test ki hain (mere paas Docker chalane ki suvidha nahi thi). App ka server aur
> HTTPS wala header maine container jaise setup me chala kar dekha hai, par pehli deploy me koi chhoti dikkat aa sakti hai.
> Error aaye to wahi text mujhe bhej dijiye.

## Kya chahiye
1. **Ek chhota online server (VPS)** — Ubuntu 22.04 ya 24.04, 1 GB RAM kaafi hai. Kisi bhi provider se le sakte hain
   (DigitalOcean, Hetzner, AWS Lightsail, Hostinger VPS, Contabo…). Kharcha provider par depend karta hai (aam taur par
   kuch sau rupaye mahina) — abhi ka rate unki website par dekhein. **Vercel / Netlify / free hosting nahi chalegi**, kyunki
   unme data permanent save nahi rehta.
2. **Ek domain ya subdomain** — jaise `cash.aapkanaam.in`. Domain kisi registrar se kharidein, ya free subdomain (DuckDNS) lein.
   HTTPS ke liye ye zaroori hai.
3. Windows par **PowerShell** (isme `ssh` aur `scp` pehle se hota hai).

## Steps
**1. Domain ko server par point karein.** Domain ke DNS me ek `A record` banayein: naam `cash` (ya jo chahiye), value = server ka IP.
Asar hone me 10–30 minute lag sakte hain.

**2. Server ka firewall.** Provider ke panel me ports **80** aur **443** open rakhein.

**3. Server se connect karein** (PowerShell me, `SERVER_IP` ki jagah apna IP):
```
ssh root@SERVER_IP
```

**4. Docker install karein** (server par):
```
curl -fsSL https://get.docker.com | sh
apt-get install -y unzip
```

**5. App ki zip server par bhejein.** Apne PC par naya PowerShell kholein, jis folder me zip hai wahan jaakar:
```
scp ravi-cash-v4.5.zip root@SERVER_IP:/root/
```
Phir server par:
```
cd /root
unzip -o ravi-cash-v4.5.zip
cd ravi-cash
printf "DOMAIN=cash.aapkanaam.in\nSETUP_KEY=koi-lamba-gupt-shabd-yahan\n" > .env
```
(`cash.aapkanaam.in` ki jagah apna domain likhein. `SETUP_KEY` ek lamba gupt shabd hai jo aap khud chunte hain — first-time setup screen par wahi poochha jayega, taaki aap se pehle koi aur setup na kar le.)

**6. Chalu karein** (server par, `ravi-cash` folder me):
```
docker compose up -d --build
```
Pehli baar 2–5 minute lagte hain. HTTPS certificate apne aap ban jata hai.

**7. Browser me apna `https://…` link kholein.** First-time setup screen aayegi (upar wala Setup key bhi daalna hoga): business ka naam, pehli branch, aur Super Admin
(aap) banayein. Phir *Users* page se staff ke ID-password banayein. **PC par START.bat se jo data tha wo yahan nahi aata** —
online server par naya, khaali system banta hai.

**8. Staff ko ye dein:** link + Branch + Username + Password. Phone ke Chrome me link kholein → login → pehli baar naya
password chunein → Chrome menu (⋮) me **Install app / Add to Home screen**.

## Roz ka kaam
* **Band / dobara chalu:** `docker compose restart` (server par, `ravi-cash` folder me). Server reboot hone par app apne aap chalu ho jati hai.
* **Dikkat dekhni ho:** `docker compose logs --tail 100 app`
* **Naya version lagana:** nayi zip `scp` se bhejein, `unzip -o`, phir `docker compose up -d --build`. Data surakshit rehta hai.

## Backup (zaroori)
**Sabse aasan:** Super Admin se sign in → menu **Backup → Download backup file** (ek `.json` file). Use Google Drive / email me rakhein.
Galti se data erase ho jaye to usi page par **Restore from a backup file** se wapas laa sakte hain (password + `RESTORE` likhna padta hai).
App khud bhi roz ek poori copy, har ghante ledger ki copy, aur har permanent delete / Clear all se pehle ek copy `data/backups` me rakhti hai
(Backup page par list me dikhti hain, wahin se Download / Restore). Par wo usi server par hoti hain — server kharab hua to wo bhi jayengi.
Isliye apni file bahar rakhein, aur chahein to hafte me ek baar ye bhi karein (server par, poora folder):
```
docker run --rm -v ravicash_ravi-data:/data -v $(pwd):/backup alpine tar czf /backup/ravicash-backup-$(date +%F).tar.gz -C /data .
```
Phir apne PC par download karein:
```
scp root@SERVER_IP:/root/ravi-cash/ravicash-backup-*.tar.gz .
```
Provider ka "snapshot / backup" option bhi chalu kar lein.

## Suraksha
* Server ka root password mazboot rakhein, aur Super Admin ka password bhi (kam se kam 8 akshar, letters + numbers).
* Super Admin ka password kisi ko na dein; staff ko sirf unke apne User account dein.
