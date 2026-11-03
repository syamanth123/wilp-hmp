/** What the login page says after a BITS sign-in came back without signing the person in. */
const MESSAGES: Record<string, string> = {
  not_set_up:
    "Your BITS account isn't set up in the Handout Portal. Please contact the Instruction Cell.",
  inactive: 'Your Handout Portal account is switched off. Please contact the Instruction Cell.',
  failed: "BITS sign-in didn't complete. Please try again.",
  unavailable: "BITS sign-in isn't available right now. Please try again later.",
  busy: 'Too many sign-in attempts from your network. Please wait a few minutes and try again.',
};

export function ssoMessage(code: string | undefined): string | null {
  return code && Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : null;
}
