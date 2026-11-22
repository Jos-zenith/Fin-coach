/** Opens the agent drawer from anywhere (import screens, dashboard, nav). */
export function openAgent(tab: 'ask' | 'trace' = 'ask') {
  window.dispatchEvent(new CustomEvent('runway:agent', { detail: tab }))
}
