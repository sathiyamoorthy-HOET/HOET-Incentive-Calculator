# HOET Incentive

Monthly incentive calculation for the House of EduTech editing team.

Upload the delivery report, and the app matches each row to an editor, prices the
minutes against the rate card for that editor's slab, compares the points earned
to their monthly target, and pays incentive on the surplus only.

It replaces the single-file `HOET-Incentive.html` tool. The calculation is
unchanged; what is new is that the rate card, team list and video-type mapping
are shared in Supabase instead of living in one person's browser, and every run
can be saved with a snapshot of the settings used.

## Stack

- Next.js 16 (App Router) on Vercel
- Supabase Postgres for shared config and run history, Supabase Auth for sign-in
- SheetJS for reading `.xlsx` / `.csv` and writing the export

Report files are parsed in the browser. Only the computed result is sent to the
server, and only when someone chooses **Save this run**.

## How the numbers work

| Concept | Meaning |
| --- | --- |
| Slab | A (6+ yrs) to D (fresher). Sets the points-per-minute rate. |
| Points | `minutes delivered x points-per-minute for that video type and slab` |
| Target | `pattern target x days available / pattern standard days` |
| Incentive | `max(0, points - target) x incentive per point` |

Minutes whose video type is not in the mapping score nothing and are flagged
after every run, as are report names that do not match anyone on the team list.

## Local development

```bash
cp .env.example .env.local   # fill in from the Supabase dashboard
npm install
npm run dev
```

## Database

The schema and seed data are one migration in `supabase/migrations`. Apply it to
a linked project with:

```bash
supabase link --project-ref <ref>
supabase db push
```

This creates the config tables, the run history tables, row-level security
policies, and the `get_config()` / `set_config()` functions the UI reads and
writes through. It also seeds the rate card, work patterns, video-type mapping
and team list that the original tool shipped with, so the app is usable
immediately.

Runs store a `config_snapshot`, so reopening a saved month reproduces the payout
that was signed off even after the rate card changes.

## Accounts

Sign-up is disabled. Create each account in the Supabase dashboard under
**Authentication -> Users -> Add user**, with "Auto Confirm User" ticked, then
send the person their password to change. Anyone signed in can read and edit the
shared config and open any saved run; only the person who saved a run can delete
it.

## Deployment

The app deploys to Vercel with `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` set as environment variables. Both are safe to
expose to the browser; access is enforced by row-level security in Postgres.
