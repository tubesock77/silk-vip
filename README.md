# Silk VIP List

Mobile signup page for the Silk Head Spa VIP list, plus a password-protected admin page.

- **Signup page:** `https://vip.silkheadspa.com` (also works at `/vip`)
- **Admin:** `https://vip.silkheadspa.com/admin`: view, search, remove, and **Download CSV**
- Tracks where people came from: add `?src=` to any link, e.g. `vip.silkheadspa.com/?src=qr`, `?src=instagram`, `?src=tiktok`
- Duplicate emails update the existing entry instead of creating a second one

## Why vip.silkheadspa.com and not silkheadspa.com/vip

silkheadspa.com runs on Vagaro, so Vagaro serves every page on that domain. A subdomain can point at Render while the main site stays on Vagaro.

---

## Setup (about 20 minutes)

### 1. Put the code on GitHub
1. On github.com, click **New repository**. Name it `silk-vip` and make it **Private**.
2. Click **uploading an existing file**, drag in everything from this folder (including the `public` folder), then click **Commit**.

### 2. Deploy on Render with the Blueprint
1. In Render, go to **New → Blueprint** and pick the `silk-vip` repo.
2. Render reads `render.yaml` and creates two things:
   - **silk-vip**: the web app (Starter plan, $7/mo, always on)
   - **silk-vip-db**: the Postgres database (Basic 256MB, about $6/mo)
3. Render asks for **ADMIN_PASSWORD**. Pick a strong one. The username is `april` (you can change `ADMIN_USER` in the service's Environment tab).
4. Click **Apply** and wait for "Live". Open the `.onrender.com` URL to test.

> Want it cheaper? You can set the web service to the **Free** plan. The catch is that it goes to sleep, so the first visitor after a quiet period waits 30–60 seconds. That's bad when someone scans a QR code. **Don't use Render's free database:** Render deletes it after 30 days, along with your list.

### 3. Connect vip.silkheadspa.com
1. In Render, open **silk-vip → Settings → Custom Domains → Add**, then enter `vip.silkheadspa.com`.
2. Render shows a **CNAME** target, something like `silk-vip.onrender.com`.
3. Go to the place that manages DNS for silkheadspa.com. That's wherever you bought the domain (GoDaddy, Namecheap, Squarespace, etc.), or Vagaro if you bought it through them. Add:
   - Type: **CNAME**  Name/Host: **vip**  Value: **silk-vip.onrender.com** (use what Render shows)
4. Don't touch the existing records for the main site. Once Render verifies the record, it issues the SSL certificate on its own, usually within an hour.

### 4. Link it from the Vagaro site (optional)
In Vagaro MySite, add a button or menu link titled "Join the VIP List" that points to `https://vip.silkheadspa.com/?src=website`.

---

## Pulling the list
Log in at `/admin` and tap **Download CSV**. The file opens in Excel or Google Sheets, and you can import it into Vagaro or a texting tool. The "Opted In" column records that each person checked the box agreeing to texts and emails.

## Running locally (optional)
```
npm install
DATABASE_URL=postgres://... ADMIN_PASSWORD=yourpass npm start
```
