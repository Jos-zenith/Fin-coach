import type { Category } from '../types'

export interface MerchantRule {
  re: RegExp
  name: string
  category: Category
  /** only applies to this direction when set */
  only?: 'debit' | 'credit'
}

/**
 * Deterministic merchant dictionary. Order matters: first match wins, so specific entries
 * (e.g. an instant-grocery arm of a delivery brand) sit above the generic brand.
 * Everything here is a merchant / biller, never a financial product.
 */
export const MERCHANTS: MerchantRule[] = [
  // --- Income (credits only) ---
  { re: /\b(salary|sal|payroll|wages)\b/i, name: 'Salary', category: 'Salary', only: 'credit' },
  { re: /\b(interest|int\.? ?(?:pd|paid|credit))\b/i, name: 'Interest', category: 'Other income', only: 'credit' },
  { re: /\b(refund|reversal|cashback)\b/i, name: 'Refund', category: 'Other income', only: 'credit' },

  // --- Debt service ---
  { re: /lic ?hou|housing ?fin|home ?loan/i, name: 'Home loan', category: 'EMI' },
  { re: /\bemi\b|\bloan\b|bajaj ?fin|tata ?capital|fullerton|home ?credit|kreditbee|zestmoney|\binstal+ment\b/i, name: 'Loan EMI', category: 'EMI' },

  // --- Rent & household ---
  { re: /\brent\b|landlord|nobroker|nestaway|housing\.com/i, name: 'Rent', category: 'Rent' },
  { re: /society|apartment|maintenance|\bmygate\b|\bnobrokerhood\b/i, name: 'Society maintenance', category: 'Utilities' },

  // --- Groceries (before delivery brands) ---
  { re: /instamart/i, name: 'Instamart', category: 'Groceries' },
  { re: /blinkit|grofers/i, name: 'Blinkit', category: 'Groceries' },
  { re: /zepto/i, name: 'Zepto', category: 'Groceries' },
  { re: /big ?basket/i, name: 'BigBasket', category: 'Groceries' },
  { re: /\bdmart\b|avenue supermarts/i, name: 'DMart', category: 'Groceries' },
  { re: /jiomart/i, name: 'JioMart', category: 'Groceries' },
  { re: /reliance (?:fresh|smart)|more retail|nature'?s? basket|spencer|supermarket|hypermarket|provision|kirana|grocer|vegetable|dairy|milk ?basket/i, name: 'Groceries', category: 'Groceries' },

  // --- Memberships billed by delivery brands (before the brand itself) ---
  { re: /swiggy ?one/i, name: 'Swiggy One', category: 'Subscriptions' },
  { re: /zomato ?gold/i, name: 'Zomato Gold', category: 'Subscriptions' },

  // --- Food delivery & dining ---
  { re: /swiggy/i, name: 'Swiggy', category: 'Food delivery' },
  { re: /zomato/i, name: 'Zomato', category: 'Food delivery' },
  { re: /eatsure|box8|faasos|freshmenu/i, name: 'Food delivery', category: 'Food delivery' },
  { re: /domino|mcdonald|\bkfc\b|pizza ?hut|burger ?king|starbucks|subway|cafe coffee|\bccd\b|barbeque|haldiram|restaurant|\bcafe\b|dhaba|bakery|biryani/i, name: 'Dining', category: 'Dining' },

  // --- Subscriptions ---
  { re: /netflix/i, name: 'Netflix', category: 'Subscriptions' },
  { re: /spotify/i, name: 'Spotify', category: 'Subscriptions' },
  { re: /hotstar|disney/i, name: 'Hotstar', category: 'Subscriptions' },
  { re: /prime ?video|amazon ?prime|prime membership/i, name: 'Amazon Prime', category: 'Subscriptions' },
  { re: /youtube ?(?:premium|music)|google ?one|google ?play|google ?storage/i, name: 'Google services', category: 'Subscriptions' },
  { re: /apple\.com\/bill|apple ?services|itunes|icloud/i, name: 'Apple services', category: 'Subscriptions' },
  { re: /sony ?liv|zee5|jio ?cinema|gaana|audible|canva|notion|openai|chatgpt|linkedin|medium\.com|adobe|dropbox|github|microsoft ?365|\bxbox\b|duolingo/i, name: 'Subscription', category: 'Subscriptions' },
  { re: /cult\.?fit|cultfit|\bgym\b|fitness|anytime fit|yoga/i, name: 'Fitness', category: 'Subscriptions' },
  { re: /rentomojo|furlenco/i, name: 'Rental subscription', category: 'Subscriptions' },

  // --- Entertainment ---
  { re: /bookmyshow|\bpvr\b|\binox\b|\bsteam\b|playstation|dream ?11|\bmpl\b/i, name: 'Entertainment', category: 'Entertainment' },

  // --- Travel ---
  { re: /makemytrip|goibibo|ixigo|cleartrip|yatra|redbus|abhibus|\boyo\b|airbnb|indigo|air ?india|vistara|akasa|spicejet|irctc/i, name: 'Travel', category: 'Travel' },

  // --- Transport (minimum) ---
  { re: /\buber\b|\bola\b|rapido|namma ?yatri|\bmetro\b|dmrc|bmtc|fastag|hpcl|bpcl|iocl|indian ?oil|petrol|fuel|shell ?india/i, name: 'Transport', category: 'Transport' },

  // --- Utilities & telecom ---
  { re: /airtel|reliance ?jio|\bjio ?(?:prepaid|postpaid|fiber|recharge)|vodafone|\bvi ?(?:prepaid|postpaid)|\bbsnl\b|act ?fibernet|hathway|tata ?(?:play|sky)|dish ?tv|broadband|postpaid|recharge/i, name: 'Telecom', category: 'Utilities' },
  { re: /electric|bescom|tneb|tangedco|msedcl|bses|tata ?power|torrent ?power|adani ?elec|kseb|\bpower\b.*bill/i, name: 'Electricity', category: 'Utilities' },
  { re: /water ?board|bwssb|jal ?board|piped ?gas|mahanagar ?gas|indraprastha|\bigl\b|\bmgl\b|\blpg\b|indane|bharat ?gas/i, name: 'Water / gas', category: 'Utilities' },

  // --- Insurance ---
  { re: /insurance|\blic\b|premium|star ?health|care ?health|niva ?bupa|\backo\b|max ?life|hdfc ?life|sbi ?life|icici ?pru|tata ?aia|bajaj ?allianz/i, name: 'Insurance', category: 'Insurance' },

  // --- Shopping ---
  { re: /amazon|flipkart|myntra|ajio|nykaa|meesho|decathlon|\bikea\b|lenskart|croma|reliance ?digital|westside|\bzara\b|h&m|uniqlo|tatacliq|shoppers ?stop|lifestyle|pantaloons/i, name: 'Shopping', category: 'Shopping' },

  // --- Family ---
  { re: /\b(family|parents?|mom|mother|dad|father|mummy|papa|amma|appa)\b/i, name: 'Family', category: 'Family Support' },

  // --- Health (no dedicated bucket: counts as flexible "Other") ---
  { re: /apollo|pharmeasy|1mg|medplus|netmeds|hospital|clinic|diagnostic|pharmacy|pharma\b|medicals?\b|\blab(?:s)?\b/i, name: 'Health', category: 'Other' },

  // --- More named services ---
  { re: /anthropic|claude\.ai|scribd|perplexity|\bmidjourney\b/i, name: 'Subscription', category: 'Subscriptions' },
  { re: /udemy|coursera|topmate|unacademy|byju|upgrad|tuition|academy|\bcollege\b|\bschool\b/i, name: 'Education', category: 'Other' },
  { re: /\bsalon\b|toni ?(?:and|&) ?guy|naturals|parlou?r|barber|\bspa\b/i, name: 'Personal care', category: 'Other' },
  { re: /life ?style|\btextiles?\b|\bfootwear\b|\bmobiles?\b|electronics?|\bstationery\b/i, name: 'Shopping', category: 'Shopping' },
  { re: /indian ?railways?|\brailway\b/i, name: 'Travel', category: 'Travel' },
  { re: /chennai ?metro|metro ?rail|\bcmrl\b|\bparking\b|\bpump ?\d|filling|service ?st(?:n|ation)?\b|petroleum|fuels?\b/i, name: 'Transport', category: 'Transport' },
  { re: /\bchrgs?\b|charges|sms ?alert|\bamc\b|annual ?fee/i, name: 'Bank charges', category: 'Other' },

  // --- Local shops: generic words, so most neighbourhood UPI payments land somewhere sensible ---
  // (checked after every brand above; medium confidence, and one correction in Review becomes a rule)
  { re: /\b(?:foods?|kitchen|hotel|mess|tiff[ie]n|bhavan|biriyani|briyani|cakes?|bakers?|sweets|mithai|juice|chai|coffee|snacks|canteen|eatery|dosa|idli|parotta|shawarma|cool ?bar|ice ?cream|baskin|falooda|chettinad|soup|tea ?(?:stall|shop|st)|gourmet|dhaba|restaurant|rest\b|cafe)\b/i, name: 'Dining', category: 'Dining', only: 'debit' },
  { re: /\b(?:stores?|stor\b|mart|super ?ma\w*|hypermark\w*|traders|general ?st\w*|fruits?|fru\b|poultry|chicken|meat|fish|provisions?|departmental|farm ?fresh|groceries|spar)\b/i, name: 'Groceries', category: 'Groceries', only: 'debit' },
]

/** Words that mean "this looks like a recurring investment-style debit; check it before counting it as spend". */
export const INVESTMENT_HINT = /\b(sip|mutual ?fund|invest(?:ment)?|demat)\b/i

/** Markers that a debit is an automatic mandate rather than a one-off. */
export const MANDATE_HINT = /\b(autopay|auto ?pay|si[- ]|standing ?instruction|mandate|nach|ach ?d|ecs|e-?mandate|razorpay|billdesk|recurring)\b/i

export function matchMerchant(text: string, direction: 'debit' | 'credit'): MerchantRule | null {
  for (const rule of MERCHANTS) {
    if (rule.only && rule.only !== direction) continue
    if (rule.re.test(text)) return rule
  }
  return null
}
