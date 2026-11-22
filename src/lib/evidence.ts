/**
 * Real user evidence for the landing page. Add only quotes you collected yourself, with the person's
 * permission to show them. Never invent one: the landing page shows this block only when it is non-empty.
 *
 * Example shape (not real):
 *   { quote: '…', who: 'First name, age, city, role', when: '2026-11' }
 */
export interface UserQuote {
  quote: string
  who: string
  when: string
}

export const USER_QUOTES: UserQuote[] = []
