# Trying the dashboard on your own computer

This is the **five-minute way to look at the dashboard** on a Windows PC, with
sample data, so you can click around and see how it works. Nothing you do here
is saved, and nothing connects to your real email or calendar — it is a safe
preview.

> When you are ready to run it for real, with your own data, that is a bigger
> setup covered in [`runbook-windows.md`](./runbook-windows.md). It is worth
> having a technical person help with that part.

---

## What you need

- A **Windows** PC.
- About **10 minutes** the first time (most of it is the computer working while
  you wait).

---

## Step 1 — Install Node.js (one time)

The app needs a free program called Node.js to run.

1. Go to **https://nodejs.org**
2. Click the big green button that says **LTS**.
3. Open the file it downloads and click **Next** until it finishes.

You only ever have to do this once.

## Step 2 — Download the dashboard

1. Go to **https://github.com/FLWizkid/Dashboard**
2. Click the green **Code** button, then **Download ZIP**.
3. Find the downloaded ZIP (usually in your **Downloads** folder), **right-click
   it → Extract All → Extract**. You now have a folder called `Dashboard`.

## Step 3 — Start it

1. Open the `Dashboard` folder.
2. Double-click the file named **`start-here`** (it has a little gear icon).
3. A black window opens. The first time, it spends a few minutes setting things
   up — that is normal. Leave it open.

> Windows may show a blue **"Windows protected your PC"** box the first time,
> because the file came from the internet. Click **More info → Run anyway**.
> (This just runs the same steps you would otherwise type by hand.)

## Step 4 — Open it in your browser

1. When the black window stops scrolling and shows the word **Ready**, open
   **Edge** or **Chrome**.
2. In the address bar, type: **http://localhost:3000** and press Enter.

That's it — the dashboard is now on your screen.

---

## A few things to try

- **The tasks box.** Type a sentence like
  `Review the security section tomorrow 4pm` and watch it pull out the date and
  priority as little chips — and keep the whole word "section" (that was one of
  the bugs just fixed).
- **Tasks**, **Email**, **Calendar**, **Kanban**, **Pomodoro**, **Hours**,
  **Reports** and **Digest** — all down the left side, with **Dashboard** at the
  top as home.
- On a narrow window it turns into the phone layout, with a **More** button for
  the rest.

## When you're done

Just **close the black window**. That stops the app. To look again another day,
double-click **`start-here`** again — it will be quick the second time.

## If something looks wrong

Take a screenshot of the black window (or the browser) and send it over. The
most common one is forgetting Step 1 (Node.js) — the black window will tell you
if that is the case and what to do.
