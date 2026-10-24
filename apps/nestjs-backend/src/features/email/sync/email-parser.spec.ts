/* eslint-disable sonarjs/no-duplicate-string */
import { BODY_MAX_LENGTH, parseEmail } from './email-parser';

const eml = (headers: string[], body: string) => Buffer.from([...headers, '', body].join('\r\n'));

describe('parseEmail', () => {
  it('reads addresses, dates and ids', async () => {
    const parsed = await parseEmail(
      eml(
        [
          'From: "Alice Smith" <alice@example.com>',
          'To: Bob <bob@example.com>, carol@example.com',
          'Cc: Team: dan@example.com, erin@example.com;',
          'Reply-To: help@example.com',
          'Subject: Quarterly report',
          'Date: Fri, 24 Oct 2026 10:00:00 +0000',
          'Message-ID: <abc@example.com>',
          'In-Reply-To: <prev@example.com>',
          'Content-Type: text/plain; charset=utf-8',
        ],
        'Numbers attached.'
      )
    );
    expect(parsed).toMatchObject({
      subject: 'Quarterly report',
      from: { address: 'alice@example.com', name: 'Alice Smith' },
      to: 'Bob <bob@example.com>, carol@example.com',
      cc: 'dan@example.com, erin@example.com',
      replyTo: 'help@example.com',
      messageId: '<abc@example.com>',
      inReplyTo: '<prev@example.com>',
      body: 'Numbers attached.',
      snippet: 'Numbers attached.',
      importance: 'normal',
      hasAttachments: false,
    });
    expect(parsed.sentAt?.toISOString()).toBe('2026-10-24T10:00:00.000Z');
  });

  it('turns HTML into markdown without remote images or unsafe links', async () => {
    const parsed = await parseEmail(
      eml(
        ['From: a@example.com', 'Subject: Hi', 'Content-Type: text/html; charset=utf-8'],
        [
          '<html><head><style>p{color:red}</style><title>t</title></head><body>',
          '<h1>Hello</h1><p>See <a href="https://example.com/x">the doc</a>',
          ' and <a href="javascript:alert(1)">this</a>.</p>',
          '<img src="https://tracker.example.com/p.gif" width="1">',
          '<img src="https://example.com/chart.png" alt="Chart">',
          '<script>alert(1)</script></body></html>',
        ].join('')
      )
    );
    expect(parsed.body).toContain('# Hello');
    expect(parsed.body).toContain('[the doc](https://example.com/x)');
    expect(parsed.body).toContain('and this.');
    expect(parsed.body).toContain('[image: Chart]');
    expect(parsed.body).not.toMatch(/tracker|javascript|alert|color:red|<img/);
  });

  it('keeps real attachments and drops inline images', async () => {
    const parsed = await parseEmail(
      eml(
        ['From: a@example.com', 'Subject: Files', 'Content-Type: multipart/mixed; boundary="b1"'],
        [
          '--b1',
          'Content-Type: multipart/related; boundary="b2"',
          '',
          '--b2',
          'Content-Type: text/html; charset=utf-8',
          '',
          '<p>Logo: <img src="cid:logo"></p>',
          '--b2',
          'Content-Type: image/png',
          'Content-ID: <logo>',
          'Content-Disposition: inline',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from('png').toString('base64'),
          '--b2--',
          '--b1',
          'Content-Type: application/pdf; name="report.pdf"',
          'Content-Disposition: attachment; filename="report.pdf"',
          'Content-Transfer-Encoding: base64',
          '',
          Buffer.from('%PDF-1.4').toString('base64'),
          '--b1--',
        ].join('\r\n')
      )
    );
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      filename: 'report.pdf',
      contentType: 'application/pdf',
      size: 8,
    });
    expect(parsed.attachments[0].content.toString()).toBe('%PDF-1.4');
    expect(parsed.hasAttachments).toBe(true);
  });

  it.each([
    ['Importance: High', 'high'],
    ['Importance: low', 'low'],
    ['X-Priority: 1 (Highest)', 'high'],
    ['X-Priority: 5', 'low'],
    ['X-Priority: 3', 'normal'],
  ])('reads %s', async (header, expected) => {
    const parsed = await parseEmail(eml(['From: a@example.com', header], 'x'));
    expect(parsed.importance).toBe(expected);
  });

  it('fills in a missing subject and caps the body', async () => {
    const parsed = await parseEmail(eml(['From: a@example.com'], 'y'.repeat(BODY_MAX_LENGTH + 10)));
    expect(parsed.subject).toBe('(no subject)');
    expect(parsed.body).toHaveLength(BODY_MAX_LENGTH);
    expect(parsed.snippet.length).toBeLessThanOrEqual(200);
  });

  it('decodes encoded words in non-ASCII headers', async () => {
    const parsed = await parseEmail(
      eml(['From: =?UTF-8?B?5byg5LiJ?= <zhang@example.com>', 'Subject: =?UTF-8?Q?Caf=C3=A9?='], 'x')
    );
    expect(parsed.subject).toBe('Café');
    expect(parsed.from).toEqual({ address: 'zhang@example.com', name: '张三' });
  });
});
