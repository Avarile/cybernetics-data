import { describeMailServerError } from './mail-server.tester';
import { renderOAuthCallbackPage } from './oauth-callback.page';

describe('renderOAuthCallbackPage', () => {
  it('posts the result only to our origin, under a nonce CSP', () => {
    const { html, csp } = renderOAuthCallbackPage(
      { status: 'success', provider: 'gmail', integrationId: 'uinA' },
      'https://app.example.com'
    );
    const nonce = csp.match(/'nonce-([^']+)'/)![1];
    expect(html).toContain(`<script nonce="${nonce}">`);
    expect(html).toContain('postMessage(message, origin)');
    expect(html).toContain('"https://app.example.com"');
    expect(csp).toContain("default-src 'none'");
  });

  it('escapes provider-controlled text in markup and script', () => {
    const { html } = renderOAuthCallbackPage(
      { status: 'error', provider: '</script><img src=x>', message: '<b>bad</b>' },
      'https://app.example.com'
    );
    expect(html).not.toContain('</script><img');
    expect(html).toContain('&lt;b&gt;bad&lt;/b&gt;');
  });
});

describe('describeMailServerError', () => {
  it.each([
    [{ authenticationFailed: true }, 'Authentication failed'],
    [Object.assign(new Error('Login is disabled'), { authenticationFailed: true }), 'sign-in'],
    [{ code: 'EAUTH' }, 'Authentication failed'],
    [{ code: 'ENOTFOUND' }, 'could not be found'],
    [{ code: 'ECONNREFUSED' }, 'refused'],
    [{ code: 'ETIMEDOUT' }, 'timed out'],
    [{ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }, 'secure connection'],
    [new Error('Host x resolves to a private address'), 'private network'],
    [new Error('* BYE internal banner'), 'Could not connect'],
  ])('maps %o', (error, expected) => {
    expect(describeMailServerError(error)).toContain(expected);
  });
});
