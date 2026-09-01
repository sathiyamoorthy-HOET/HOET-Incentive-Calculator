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

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` carry no `NEXT_PUBLIC_` prefix on
purpose: every Supabase call happens on the server, in the proxy and in Server
Actions, so the browser never needs them. The legacy `NEXT_PUBLIC_` names are
still read as a fallback.

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

Access is limited to the addresses in the `allowed_emails` table, enforced twice
over so the dashboard's "allow signups" toggle is not the only thing standing
between a stranger and the payroll data:

- a trigger on `auth.users` refuses to create an account for an address that is
  not listed, so an open signup form still cannot produce a usable account;
- every row-level security policy requires the caller to be on the list, so an
  account created out of band sees nothing at all.

To give someone access, add their address to `allowed_emails` first, then create
the account under **Authentication -> Users -> Add user** with "Auto Confirm
User" ticked. Doing it in the other order fails, by design. The last address on
the list cannot be deleted, so the project cannot be locked out of itself.

Anyone on the list can read and edit the shared config and open any saved run;
only the person who saved a run can delete it. There is no self-serve password
reset: reset passwords from the Supabase dashboard.

## Deployment

The app deploys to Vercel with `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
set as environment variables, typed as Config rather than Secret. Neither is
inlined into the client bundle, which the build can be checked against:

```bash
grep -rl "sb_publishable_" .next/static | wc -l   # expect 0
```

Access is enforced by row-level security in Postgres, not by key secrecy.
