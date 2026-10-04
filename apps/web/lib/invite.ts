const KEY = 'botornot.invite';
let fromThisPage: string | undefined;

/**
 * The invite code for an invite-only server. Opening an invite link (?invite=...) saves the code
 * in this browser and tidies it out of the address bar, so later visits work without the link.
 */
export function inviteCode(): string | undefined {
  const url = new URL(window.location.href);
  const fromLink = url.searchParams.get('invite');
  if (fromLink) {
    fromThisPage = fromLink;
    url.searchParams.delete('invite');
    window.history.replaceState(window.history.state, '', url);
    try {
      localStorage.setItem(KEY, fromLink);
    } catch {
      // Storage blocked: the code still works until the page is closed.
    }
  }
  if (fromThisPage) return fromThisPage;
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
