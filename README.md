# TCRS HQ — setup

TCRS HQ is the sales hub for Twin Cities Remodeling Supply. It holds the pipeline board, the race view for the office TV, the Drop (Claude reads emails, call notes, photos and PDFs), the layout grid, and the estimate that grows into the quote.

It's built from three pieces:

- **This repository**, published by GitHub Pages: the app people open and install.
- **Supabase**: the database, logins and file storage.
- **The `hq-ai` function in Supabase**: holds the Anthropic API key and does the Claude reading.

No secrets live in this repository. `config.js` holds only the public Supabase URL and the publishable key. The database rules (`supabase/schema.sql`) decide who can read and write.

---

## 1. Database (5 min)

1. In Supabase, open your project and go to **SQL Editor → New query**.
2. Paste all of `supabase/schema.sql`, then press **Run**. It should say "Success. No rows returned."

The script is safe to run again later.

## 2. Claude reading function (5 min)

1. Go to **Edge Functions → Secrets** and confirm `ANTHROPIC_API_KEY` is there.
2. Go to **Edge Functions → Deploy a new function → Via Editor**.
3. Name it exactly **`hq-ai`**.
4. Replace the sample code with all of `supabase/functions/hq-ai/index.ts`, then press **Deploy**.
5. Leave **"Verify JWT"** (JWT verification) on. That limits the function to signed-in users.

## 3. Logins (10 min)

1. Go to **Authentication → Users → Add user → Create new user** for each person. Use their email and a starting password, and tick **Auto Confirm User**.
   - Zuggy: nathan@tcremodelingsupply.com
   - Lee, Trevor and the A4L salesperson: their own emails
   - The office TV: for example `tv@tcremodelingsupply.com`
2. Back in **SQL Editor**, set the roles. Change the emails if yours differ:

   ```sql
   update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'nathan@tcremodelingsupply.com');
   update public.profiles set role = 'tv'    where id = (select id from auth.users where email = 'tv@tcremodelingsupply.com');
   ```

   Everyone else stays **sales**. Admins can change roles later in HQ → Prices & partners → Team.
3. Go to **Authentication → URL Configuration** and set **Site URL** to the HQ address from step 4. Password-reset emails link there.

## 4. Hosting (5 min)

In this GitHub repository, go to **Settings → Pages**:

1. Under **Source**, choose **Deploy from a branch**.
2. Choose **Branch: `main`**, folder **`/ (root)`**, then **Save**.

After a minute or two, the address appears at the top of that page, e.g. `https://<account>.github.io/tcrs-hq/`.

## 5. Install it

| Device | How |
|---|---|
| iPhone | Open the address in Safari, then **Share → Add to Home Screen**. |
| Android | Open it in Chrome, then **⋮ → Install app** (or "Add to Home screen"). |
| Windows / Mac | Open it in Chrome or Edge, then click the **install icon** in the address bar. |
| Office TV | Open it in the TV's browser, sign in with the TV login, and go full screen. It opens on the race board and refreshes itself. |

---

## Roles

| Role | Can do |
|---|---|
| admin | Everything, including Settings and Team roles. |
| sales | Everything except Settings and roles. |
| tv | Read the race board only. Can't change anything or use Claude. |

## Costs

These are estimates as of November 2026. Check each vendor's pricing page.

- **Supabase free tier:** fine to start. Free projects pause after about a week with no activity; a TV that stays signed in keeps it active. Pro is about $25/month.
- **Anthropic API:** pay per use. Likely a few cents per text drop. Drops with photos or PDFs cost more (estimate).
- **GitHub Pages:** free for a public repository.

## What isn't connected yet

- **Gmail:** paste the email thread into the Drop. Automatic inbox reading needs Google sign-in on the function and is a later step.
- **QuickBooks and Clover:** HQ records payments typed in on the Money tab. It doesn't read either system yet.
- **Photoreal renderings:** the layout grid exports plan and wall PNGs. Upload renderings as files of type "Rendering".
