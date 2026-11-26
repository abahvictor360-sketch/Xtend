/**
 * Ask Xtend only proposes changes; a card's button makes them. A model can
 * still write "Done, I have added the store" with no card behind it
 * (2026-11-26: a store "added and allocated" that never was). When an answer
 * claims a change and this turn proposed nothing, the user is told plainly.
 * Pure, so scripts/check-assistant-actions.ts can test it.
 */

const CLAIM =
  /\b(?:done|completed|successfully|(?:has|have|had) been (?:added|allocated|assigned|created|updated|changed|sent|saved|set|recorded|deactivated|removed)|(?:i(?:'ve| have)|we(?:'ve| have)) (?:now )?(?:added|allocated|assigned|created|updated|changed|sent|saved|set|recorded|deactivated|removed))\b/i

export function claimsChange(text: string): boolean {
  return CLAIM.test(text)
}

export const NOTHING_CHANGED =
  'Note: this answer did not change anything. Only the button on a card makes a change, and there is no card here. Ask again, or do it on the page.'

/** The answer as shown: with the note when it claims a change nobody can apply. */
export function guardClaims(text: string, proposedSomething: boolean): string {
  return !proposedSomething && claimsChange(text) ? `${text}\n\n${NOTHING_CHANGED}` : text
}
