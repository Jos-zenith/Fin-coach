# Runway — local-first cash-flow coach

**Know how long your money lasts.** Runway turns messy Indian bank, card and UPI data into a private, forward-looking survival plan: how many months your cash covers, where money quietly leaks, and how today's choices move your runway and goal date.

Everything runs in the browser. No bank login, no SMS permission, no account, no server, no analytics, no loan offers.

## Who pays

Free for individuals. Employers pay for it as a financial-wellness benefit for their staff. Lenders never pay: no loan commissions, no data sales. (Shown on the landing and Privacy pages; the wording lives in `BUSINESS_MODEL` in `src/lib/copy.ts`. Real user quotes go in `src/lib/evidence.ts` and appear on the landing page only once added.)

## Words Runway uses

One phrase per idea, everywhere (`TERMS` in `src/lib/copy.ts`, shown in Full breakdown and on Privacy): **accessible cash**, **essentials**, **flexible spending**, **survival runway**, **lifestyle runway**, **surplus**.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 135 unit tests (engine, parsers, requirements, trust, agents, guardrails, sample)
npm run build      # type-check + production build to dist/
```

> Windows + Git Bash: run `npm test` from PowerShell or a `D:\` path. Vitest fails to find suites when the drive letter is lower-case (`/d/...`).

## The eight requirements and where they live

| # | Requirement | Where |
|---|---|---|
| 1 | PDF, CSV and SMS ingestion with auto-categorization | **Import**: CSV / Excel with a column mapper; PDF (password-protected too) read in the browser with pdf.js; SMS paste. Each shows "Auto-classified X of Y. Z need review." Duplicates are flagged, and card bills and self-transfers are excluded. |
| 2 | Correction loop that learns rules | **Review**: match on any text, the merchant or the UPI ID only; "only this transaction"; P2P split keeping your share; manual split across categories; Undo. Rules apply to history at once and to every future import. **Rules** library: edit, delete, tester. |
| 3 | Recurring payments, change and unused alerts | **Leak Radar**: 25–35-day cadence, UPI AutoPay / NACH / SI markers, price up / down, new recurring charge, possibly unused (membership with no matching usage for 60+ days), unknown mandates, double charges. Keep / Cancel / Needs review feed the simulator. |
| 4 | Persistent profile with goals | **Profile & Goals**: take-home, payday, accessible cash, essentials, emergency fund (target, balance, date), dated goals, risk preference (wording only), runway alert threshold. Stored in IndexedDB. |
| 5 | Goal planning with what-if | **Simulator**: cut one category (e.g. dining out 30%), cut all flexible spend, cancel drains, rent / EMI increase, months without salary, an emergency expense. Before/after for runway, surplus, emergency-fund date and every goal, each with a "How?" panel. Saved scenarios compared side by side. |
| 6 | Spending-drift nudges | **Nudge Center** and dashboard: pace measured from payday to payday, goal-date delay, essential-cost increases, unused subscriptions, runway warning, good news. Each nudge has a consequence and one action. Dismissals persist, and the facts stay visible elsewhere. |
| 7 | Monthly review | **Monthly Review**: month at a glance, runway movement (from statement balances), what changed, corrections learned, goal status, next mission. Print or export as Markdown. |
| 8 | Guardrails | Global footer, Privacy page, and the simulator: education only, no products, securities, lending or data sale. The server-processing notice is shown as not in effect, because there is no server. |

## Agents (local-first)

A Supervisor plus four specialists, all running in the browser on the deterministic engine. Agents plan, call tools, verify and explain; **they never do arithmetic**. Every run is recorded in the **Trace** drawer (plan, tool calls with inputs/outputs, checks, guardrails, approval).

| Agent | Does |
|---|---|
| Ingestion & Reconciliation | Detects the layout (HDFC / ICICI / SBI / Axis / card), extracts, reconciles balances, and retries on failure (month-first dates, opposite sign, swapped debit/credit, direction repair from the running balance) before asking you |
| Insight & Triage | Asks one high-impact question at a time (reimbursements, unknown recurring charges, savings-style debits, big unclassified spends); each answer becomes a rule and the effect is reported |
| Goal Planner | Turns “my rent is going up ₹3,500, can I still build my emergency fund by Dec 2027?” into simulator calls, solves for the smallest adjustment that meets the date, ranks options; you approve before anything is applied |
| Monthly Review & Drift | Payday-paced drift, a grounded monthly brief (every figure checked against the metrics), one next mission |

**Ask Runway (optional, off by default):** with consent and your own API key, Claude (`claude-opus-5-5`) only converts the sentence into simulator parameters. It receives the question plus category, goal and merchant names: no amounts, narrations, UPI IDs, balances or account numbers. On refusal or error the local parser is used. The SDK loads only when the mode is switched on.

**Guardrails:** product-advice questions (funds, stocks, FDs, insurance plans, loans, “where should I invest”) are blocked and logged; cash-flow questions that mention a product (“what if my loan EMI rises”) are answered.

## Trust features

- **The dashboard always shows your real numbers.** The simulator never changes them; a note says when the simulator holds unapplied changes.
- **Opening + Credits − Debits = Closing.** Checked for every bank statement, and for PDFs against the balances printed on the statement (catches a dropped first or last row that the row chain alone cannot see).
- **Card bills paired.** Each bank-side card bill is matched to the card statement's “payment received”, and both rows say so.
- **Balance reconciliation.** For bank statements with a balance column (CSV, Excel, PDF), every row is checked: previous balance ± amount = this balance. Oldest-first and newest-first files are both handled. Breaks are reported with the date and the rupee gap.
- **Reimbursements are netted.** Money back from someone you paid (same UPI ID or name, within 45 days) reduces that spending instead of counting as income.
- **Honest ranges.** While transactions are unreviewed, lifestyle runway is shown as a range: counted as spending vs. not.
- **Recurring labels say what is known.** "Seen 3× · steady" vs "Seen 2× · tentative", and "Mandate marker in statement" vs "Pattern only, not a confirmed mandate", plus the next expected debit. Two similar restaurant or shopping bills a month apart are not called a subscription unless the bank marks them as automatic.
- **Assumptions & limitations** are listed in the Monthly Review (and print) and on the Privacy page.
- **Privacy at the point of upload**: every import screen says the data is read in the browser and how to verify it (Network tab).

## Screens

| Screen | What it does |
|---|---|
| **Start** | Load the sample mission, import data, or build a profile by hand. |
| **Runway (dashboard)** | Survival and lifestyle runway, timeline, take-home, cash, essential burn, surplus, fixed-cost and flexible blocks, emergency fund and goals with target dates, leak alerts, drift alerts, EMI load, noise removed. |
| **Import** | CSV / Excel, PDF, SMS, profile tabs, each with a preview before anything is saved. |
| **Review**, **Leak Radar**, **Simulator**, **Nudges**, **Monthly Review**, **Profile & Goals**, **Rules**, **Privacy** | See the table above. Every major number has a "How is this calculated?" panel (definition, formula, inputs, assumptions, limitations). |

## Architecture

```
src/lib/
  ingest/      statement.ts (CSV/XLSX rows → records, layout detection), pdf.ts (pdf.js text → rows), sms.ts, sanitize.ts
               (VPA extraction, card-bill / self-transfer / P2P rules), merchants.ts, build.ts (ids, de-dup)
  engine/      resolve.ts (rules on top of the baseline), recurring.ts (series, leaks, salary),
               model.ts (burn, runway, surplus, goals, DTI, noise, scenarios), nudges.ts (payday pace + nudges),
               review.ts (monthly briefing + Markdown export)
  db.ts        Dexie / IndexedDB: transactions, rules, key-value (profile, sim, scenarios, decisions)
  backup.ts    export / import, optional passphrase encryption
  sample.ts    "Rohan": raw narrations pushed through the real sanitizer
src/app/       store (live queries + memoized model), hash router, shell
src/pages/     one file per screen
```

- **The model is one pure function**: `buildModel({ txns, rules, profile, sim })`. Raw imports are stored once; categories are recomputed from rules on every change, so a new or deleted rule applies to all history instantly (about 2 ms for the sample, and under 200 ms for 1,000 transactions in the tests).
- **Precedence:** a pin on one transaction beats a "contains" rule, a newer rule beats an older one, and both beat the built-in classifier.
- **Conservative defaults:** unknown debits count as flexible spend, and transfers to people are never excluded automatically. Card-bill payments are excluded, and the app warns when that leaves card spending missing because no card statement is loaded. Goal dates round up and are capped at 120 months.

## Formulas (PRD §6)

```
EMB  = Rent + EMIs + Utilities + Groceries + Family Support + Insurance + Minimum Transport
FS   = Dining + Delivery + Shopping + Entertainment + Travel + Subscriptions + Other
Survival runway  = Cash ÷ EMB                 (moved only by rent / EMI stress)
Lifestyle runway = Cash ÷ (EMB + FS)
Surplus          = Take-home − EMB − FS
Months to goal   = (Target − Saved) ÷ Contribution   · ≤0 or >120 → "Not achievable at current pace"
EMI load         = EMIs ÷ Take-home  (35% caution / 40% higher stress — rules of thumb)
```

Statement figures are monthly averages over the imported period; a figure typed in the profile replaces the statement figure for that line.

## Known limitations

- PDF parsing is best-effort: it needs selectable text (no OCR for scanned PDFs), looks for dated rows with paise-formatted amounts, and infers debit/credit from the running balance, Dr/Cr markers, or keywords (flagged so you can flip it). Tested on a generated HDFC-style statement, including a password-protected copy, not on real bank PDFs. Old `.xls` is not supported.
- "Possibly unused" only works for memberships whose use shows up as spending (Swiggy One, Zomato Gold, Amazon Prime, Uber One, Flipkart Plus). Streaming and similar services show no usage in bank data, and the app says so.
- Drift pace uses your latest transaction as "today". If the card statement does not reach into the current pay cycle, the Nudge Center warns that card spending is missing.
- Merchant classification is a deterministic list plus your rules; anything else lands in the review queue.
- Leak detection needs two or more charges 25–35 days apart. Repeats are not proof of an active mandate, and Runway cannot cancel anything.
- Card-debt payoff ignores interest. Annual payments are spread only over the months in your data.
- Data lives in this browser's IndexedDB, unencrypted and unsynced. Use export to move or back it up.

## Verify before pitching

Market statistics (63% / 83%), competitor feature claims, NPCI mandate wording (the app links to npci.org.in, not a deep page), Google Play SMS policy wording, and the SEBI guidance referenced in the PRD have not been checked live.
