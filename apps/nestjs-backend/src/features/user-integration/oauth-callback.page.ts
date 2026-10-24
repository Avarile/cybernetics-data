/* eslint-disable @typescript-eslint/naming-convention */
import { randomBytes } from 'crypto';
import type { IOAuthCallbackResult } from './user-integration.service';

export const USER_INTEGRATION_CHANNEL = 'user-integration';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );

// JSON inside <script>: escape what could end the element or start a comment
const toScriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/**
 * The page the OAuth popup lands on. It tells the opener (only on our own origin) and any other
 * tab listening on the BroadcastChannel how it went, then closes itself.
 */
export const renderOAuthCallbackPage = (result: IOAuthCallbackResult, origin: string) => {
  const nonce = randomBytes(16).toString('base64');
  const message = { type: USER_INTEGRATION_CHANNEL, ...result };
  const text =
    result.status === 'success'
      ? 'Mailbox connected. You can close this window.'
      : `Connection failed: ${result.message}`;
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Mailbox connection</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem;">
<p>${escapeHtml(text)}</p>
<script nonce="${nonce}">
(function () {
  var message = ${toScriptJson(message)};
  var origin = ${toScriptJson(origin)};
  try { if (window.opener) window.opener.postMessage(message, origin); } catch (e) {}
  try { var channel = new BroadcastChannel(${toScriptJson(USER_INTEGRATION_CHANNEL)}); channel.postMessage(message); channel.close(); } catch (e) {}
  if (message.status === 'success') setTimeout(function () { window.close(); }, 300);
})();
</script>
</body>
</html>`;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
  return { html, csp };
};
