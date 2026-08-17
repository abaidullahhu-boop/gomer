# Gomer — user guide

Gomer is an AI coworker for your ad operations. It lives in Slack, connects to
the accounts you already use, and can answer questions, make changes, send
reports, and watch your accounts while you're not looking.

You talk to it in plain English. There are no commands to memorise.

- [Setting up](#setting-up)
- [Talking to Gomer](#talking-to-gomer)
- [Asking about performance](#asking-about-performance)
- [Real ROAS, verified against Stripe](#real-roas-verified-against-stripe)
- [Making changes to campaigns](#making-changes-to-campaigns)
- [Reports into Google Sheets](#reports-into-google-sheets)
- [Rules that run without you](#rules-that-run-without-you)
- [Alerts](#alerts)
- [Teaching Gomer about your business](#teaching-gomer-about-your-business)
- [Scheduled check-ins](#scheduled-check-ins)
- [The dashboard](#the-dashboard)
- [Credits](#credits)
- [For workspace admins](#for-workspace-admins)
- [When something doesn't work](#when-something-doesnt-work)

---

## Setting up

**1. Install Gomer into Slack.** From the dashboard, choose *Add to Slack* and
approve the permissions. Gomer will send you a short intro message. Whoever
installs it becomes the workspace admin.

**2. Connect your accounts.** Dashboard → **Integrations** → find the service →
**Connect**. Sign in to that service as you normally would; Gomer never sees or
stores your password.

For ad operations you'll want **Meta Ads**, **Google Ads**, **Stripe** (for
verified revenue), and **Google Sheets** (for reports).

### Team or private — the one setup choice that matters

Every connection is either:

- **Team (shared)** — everyone in your Slack workspace can use it through Gomer.
- **Private** — only you can use it.

Use **Team** for shared business accounts: the ad accounts, the company Stripe,
the reporting spreadsheet. Use **Private** for anything personal, like your own
inbox.

This trips people up constantly, in one specific way: if you connect an account
as **Private** and then a colleague asks Gomer about it, Gomer will correctly say
that service isn't connected — because for them, it isn't. If you're sharing a
screen or handing work between people, connect as **Team**.

> When you connect Google Sheets, make sure you grant **write** access on
> Google's consent screen. A read-only grant looks fine until Gomer tries to
> write your first report and fails.

---

## Talking to Gomer

**DM it.** Message Gomer directly like a coworker. Best for anything you don't
need the rest of the team to see.

**@mention it in a channel.** Gomer reads the thread it's mentioned in, so you
can pull it into a conversation already in progress and it will have the context.

**Threads have memory.** Follow-up questions in the same thread work the way
you'd expect — "and what about last week?" continues from what you were just
discussing. Starting a *new* thread gives Gomer a clean slate, which is what you
want when you switch topics.

---

## Asking about performance

Just ask. Some things that work:

- *how did we do last week?*
- *which campaigns are wasting money right now?*
- *what's our CPA on the summer sale campaign over the last 3 days?*
- *compare this month to last month on Google Ads*
- *why did spend jump on Tuesday?*

Gomer pulls live numbers from the ad accounts you've connected. It will tell you
the window it used, and it will say so when the data is too thin to draw a
conclusion from rather than guessing.

---

## Real ROAS, verified against Stripe

Meta reports the revenue it thinks it caused. Stripe knows what actually landed in
your bank account. Those two numbers are rarely the same, and the gap is usually
the most useful thing on the page.

With Stripe connected:

- *what's our real ROAS for the last 7 days?*

Gomer pairs ad spend with actual Stripe revenue and shows you the verified figure
next to the platform's own claim.

One honest limitation it will tell you about: Stripe revenue is **blended**. It
includes money from customers who never saw an ad — organic, email, returning
customers. So verified ROAS is a reality check on the platform's number, not a
per-campaign attribution model. Gomer states this caveat rather than letting you
read the number as something it isn't.

---

## Making changes to campaigns

Gomer can pause, resume, scale, adjust budgets and bids, and duplicate campaigns.

- *pause the campaigns with a CPA over £40*
- *increase the budget on the winning ad set by 20%*

**Changes to Meta Ads always ask first.** Gomer describes exactly what it's about
to do and shows **Approve** and **Cancel** buttons. Nothing happens until you
press Approve. This is deliberate — it's your ad spend.

Read the description before approving. If it's not what you meant, press Cancel
and rephrase; you don't need to undo anything.

---

## Reports into Google Sheets

- *export our verified ROAS history to a spreadsheet*

Gomer creates the sheet, writes the headers and rows, and gives you the link.
Numbers arrive as numbers, so they sort and chart in Sheets straight away.

To make it recurring:

- *every Monday at 8am put last week's campaign performance in that same sheet*

Gomer confirms the schedule before creating it, and reuses the spreadsheet you
already have rather than making a second one.

Useful to know:

- **Repeat runs append, they don't duplicate.** Each run picks up from the newest
  row it already wrote, so the sheet builds a history.
- *run that export now* runs it off-schedule, so you don't have to wait until
  Monday to check it works.
- *what reports are running?* lists every schedule with its destination, last run,
  and row count.

---

## Rules that run without you

A rule is a standing instruction Gomer checks on a schedule and acts on.

- *every night at 2am pause any campaign whose CPA over the last 3 days is above 40*
- *scale the ad sets with ROAS above 4 by 20% each morning*
- *just tell me if spend on any account goes over 500 in a day — don't change anything*

Gomer reads back the metric, threshold, window, action, schedule, and guardrails,
and asks you to confirm before the rule exists.

A rule watches one measure — **spend, CPA, ROAS, verified ROAS, CTR or CPC** — at
the account, campaign, or ad-set level, and does one of three things when the
threshold is crossed: **alert** you, **pause**, or **scale** the budget. Rules
that pause or scale also report what they did, so you're never surprised by a
change you didn't watch happen. (Verified ROAS is account-level only, since it
depends on total Stripe revenue.)

Ask *what rules are running?* at any time. Rules can be paused or deleted the
same way you made them — just say so.

Rules and one-off changes are different things. Asking Gomer to pause something
pauses it once. A rule keeps checking, indefinitely, until you turn it off.

---

## Alerts

Separate from rules, Gomer watches your Meta ad accounts every hour and speaks up
when something looks wrong — without you configuring anything per-campaign.

It reports:

- **CPA spikes** — today's cost per purchase is more than 30% above the 7-day average
- **ROAS drops** — today's return is more than 30% below the 7-day average
- **Spend spikes** — today's spend is already more than double a normal full day

Tell it where to post:

- *remember our alerts channel is #ads-alerts*

Until you do that, alerts have nowhere to go and stay silent.

Two things that keep alerts trustworthy rather than annoying: each alert fires **at
most once per day**, and accounts spending very little today are ignored, because
small numbers produce dramatic-looking percentages that mean nothing.

If the alerts channel is quiet, nothing has deviated far enough to be worth your
attention. That's the system working.

---

## Teaching Gomer about your business

Tell Gomer things once and it remembers them across every future conversation.

- *our target ROAS is 3*
- *we don't run ads on weekends*
- *the Q4 campaign is the priority this month*

It saves these quietly rather than making a performance of it, then uses them —
so when you later ask how a campaign is doing, it compares against *your* target
instead of a generic benchmark.

Ask *what do you remember about us?* to see the list, and tell it to forget
anything that's gone stale.

---

## Scheduled check-ins

Beyond rules and reports, you can ask for any recurring prompt:

- *every weekday at 9am, summarise yesterday's spend and flag anything unusual*

These post into Slack on schedule. Manage them in the dashboard under **Tasks**,
or just ask *what's scheduled?*

---

## The dashboard

Slack is where the work happens; the dashboard is for setup and oversight.

| Page | What it's for |
| --- | --- |
| **Integrations** | Connect and disconnect accounts, set Team or Private |
| **Skills** | Install expertise packs — creative analysis, PMax audits, attribution diagnostics and similar — which Gomer draws on when relevant |
| **Tasks** | Your scheduled prompts |
| **Automations** | What Gomer runs unattended: rules and what they've triggered, scheduled reports, remembered facts, verified-ROAS history |
| **Usage** | What's been spent, by whom, on what |
| **Billing** | Credit balance, top-ups, full history |
| **Admin** | Members, analytics, revenue (admins only) |

**Automations is read-only.** It shows you what's running; you still create and
change these by asking Gomer, because it confirms the details with you first —
the threshold, the window, the guardrails — and a form can't do that as well. So
to add a rule or drop a remembered fact, just say so in Slack, then check this
page to see it.

---

## Credits

Gomer runs on credits. **100 credits = $1.**

Every new workspace starts with **$100 of free credits**.

Credits are consumed when Gomer thinks — answering a question, running a
scheduled task, evaluating a rule. Connecting accounts, browsing the dashboard,
and reading old messages are free.

You'll get:

- a **heads-up in Gomer's replies** once the balance is under $10
- a **clear stop** at zero: Gomer explains it's out of credits and links you to
  top up, rather than failing in a confusing way

To top up: **Billing** → pick a pack ($25 / $50 / $100 / $250) → pay through
Stripe. Your balance updates once the payment confirms, which takes a second or
two — refresh if it hasn't landed yet.

The Usage page breaks down where credits went, including which teammate spent
them. Admins get a fuller view under **Admin → Analytics**, where automated work
is attributed to "System (rules & tasks)" rather than to a person.

---

## For workspace admins

**Admin** in the sidebar (visible only to admins) gives you:

- **Overview** — members, credit position, usage, connected accounts
- **Analytics** — daily usage and your heaviest spenders
- **Revenue** — money in against credits out
- **Users** — the full roster, including deactivated people

**Deactivating someone** removes their access. Two safeguards: you can't
deactivate yourself, and you can't remove the last remaining admin, so a
workspace can never lock itself out.

One timing detail worth knowing: a deactivated person may keep access for **up to
15 minutes** if they're mid-session, because sessions are renewed on a short
cycle rather than checked on every click. They cannot renew once deactivated. If
you need someone out *immediately*, deactivate them and also remove them from the
Slack workspace.

---

## When something doesn't work

| What you see | Usually means | What to do |
| --- | --- | --- |
| "That service isn't connected" | It's connected as **Private** by someone else, or not at all | Check Integrations; reconnect as **Team** if it should be shared |
| Gomer can't write to your spreadsheet | Google was granted read-only access | Revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), reconnect, grant write |
| Gomer mentions campaigns that don't exist | You're in an old thread carrying stale context | Start a new thread |
| "Out of credits" | Balance hit zero | Top up in Billing |
| Alerts never arrive | No alerts channel set, or nothing has deviated | Set the channel; otherwise this is normal |
| A change you approved didn't happen | The ad account connection expired | Reconnect the account in Integrations, then try again |
| Gomer answers about the wrong account | Multiple ad accounts connected | Name the account explicitly in your question |
| "Too many requests" | You've made a lot of requests very quickly | Wait a few minutes |

If Gomer can't do something, it will say so plainly and tell you why. It's built
to admit a limit rather than invent an answer — so when it says the data doesn't
support a conclusion, take that at face value.
