// Supervisor guardrails: education and scenario modelling only.

/** Financial products Runway never recommends, compares or helps choose. */
const PRODUCT =
  '(?:stocks?|shares?|equit(?:y|ies)|mutual ?funds?|\\bmfs?\\b|\\bsips?\\b|etfs?|index funds?|\\bfds?\\b|fixed deposits?|recurring deposits?|bonds?|debentures?|crypto|bitcoin|\\bgold\\b|\\bsgbs?\\b|\\bnps\\b|\\bppf\\b|\\belss\\b|ulips?|insurance (?:plans?|polic(?:y|ies)|products?)|term (?:plan|insurance)|endowment|(?:personal |home |car |instant |gold )?loans?|credit cards?|\\bbnpl\\b|smallcase|portfolio|schemes?)'

/**
 * Requests Runway must not answer: choosing, buying or comparing securities, funds, deposits,
 * insurance products or loans. Cash-flow questions that merely mention one ("what if my loan EMI
 * rises", "what if I stop my SIP") stay allowed.
 */
const PROHIBITED_REQUEST: RegExp[] = [
  // "which / best / better / recommend ... <product>"
  new RegExp('\\b(?:which|best|better|recommend|suggest|good|worth|top|ideal|safest|highest)\\b[^.?!]*' + PRODUCT, 'i'),
  // "<product> ... better / safer / worth it" (comparison after the product)
  new RegExp(PRODUCT + '[^.?!]*\\b(?:better|worse|safer|best|worth it|right for me)\\b', 'i'),
  // "what <product> ..." but not "what if ..."
  new RegExp('\\bwhat (?!if\\b)[^.?!]*' + PRODUCT, 'i'),
  // "should / can / is it wise to buy | invest | put | park | start | open | take | switch ... <product>"
  new RegExp('\\b(?:should|shall|can|could|is it (?:wise|smart|good|ok|okay) to|do you think i should)\\b[^.?!]*\\b(?:buy|invest|put|park|move|start|open|take|get|switch|sell|choose|pick)\\b[^.?!]*' + PRODUCT, 'i'),
  // "invest / put / park my money in ..."
  new RegExp('\\b(?:invest|put|park)\\b[^.?!]*\\b(?:in|into)\\b[^.?!]*' + PRODUCT, 'i'),
  // general investment advice with no product named
  /\b(?:where|how) (?:should|do|can|could) i invest\b|\bwhere to invest\b|\binvestment (?:advice|tips?|ideas?)\b|\btax[- ]saving (?:scheme|option|investment)s?\b/i,
]

export function checkRequest(text: string): { allowed: true } | { allowed: false; reason: string } {
  if (PROHIBITED_REQUEST.some((re) => re.test(text)))
    return {
      allowed: false,
      reason:
        'Runway is an educational cash-flow tool. It does not recommend securities, funds, deposits, insurance products or loans. I can show how a change in your spending, income or costs moves your runway and goal dates.',
    }
  return { allowed: true }
}

/** Words that would turn an explanation into product advice. Generated text must not contain them as a recommendation. */
const PROHIBITED_OUTPUT = /\b(you should (?:buy|invest|sell|take)|recommend(?:ed)? (?:buying|investing|the)|mutual fund|stock|equity|crypto|fixed deposit|liquid fund|ulip|elss|personal loan|insurance plan)\b/i

export function checkOutput(text: string): { ok: boolean; hit?: string } {
  const m = text.match(PROHIBITED_OUTPUT)
  return m ? { ok: false, hit: m[0] } : { ok: true }
}

/**
 * Grounding check: every rupee amount and every "N months/days/weeks" in generated text must appear
 * in the tool outputs it was built from. Catches invented numbers.
 */
export function ungroundedNumbers(text: string, toolOutputs: unknown[]): string[] {
  const corpus = JSON.stringify(toolOutputs)
  const numsInCorpus = new Set<string>()
  for (const m of corpus.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const n = Number(m[0])
    numsInCorpus.add(String(Math.round(n)))
    numsInCorpus.add(n.toFixed(1))
  }
  const missing: string[] = []
  for (const m of text.matchAll(/₹\s?([\d,]+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s?(months?|days?|weeks?|%)/g)) {
    const raw = (m[1] ?? m[2]).replace(/,/g, '')
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    const ok = numsInCorpus.has(String(Math.round(n))) || numsInCorpus.has(n.toFixed(1))
    if (!ok) missing.push(m[0])
  }
  return missing
}

export const EDU_LINE = 'Educational cash-flow simulation only. Not investment advice.'
