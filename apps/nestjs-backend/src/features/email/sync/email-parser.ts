/* eslint-disable @typescript-eslint/naming-convention */
import type { AddressObject, Attachment } from 'mailparser';
import { simpleParser } from 'mailparser';
import TurndownService from 'turndown';

export const BODY_MAX_LENGTH = 100_000;
const SNIPPET_LENGTH = 200;
const MAX_ATTACHMENTS = 20;

export interface IParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface IParsedEmail {
  subject: string;
  from?: { address: string; name: string };
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  sentAt?: Date;
  messageId?: string;
  inReplyTo?: string;
  body: string;
  snippet: string;
  importance: 'low' | 'normal' | 'high';
  attachments: IParsedAttachment[];
  /** attachments not counted in `attachments` (inline images are excluded entirely) */
  hasAttachments: boolean;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});
const REMOVED_ELEMENTS = new Set(
  [
    'script',
    'style',
    'head',
    'title',
    'meta',
    'link',
    'iframe',
    'object',
    'embed',
    'form',
    'noscript',
    'svg',
  ].map((name) => name.toUpperCase())
);
turndown.remove((node) => REMOVED_ELEMENTS.has(node.nodeName.toUpperCase()));
// remote images in mail are often tracking pixels; keep only their description
turndown.addRule('imageAlt', {
  filter: 'img',
  replacement: (_content, node) => {
    const alt = (node as HTMLElement).getAttribute?.('alt')?.trim();
    return alt ? `[image: ${alt}]` : '';
  },
});
// keep links readable, but only web and mail links
turndown.addRule('safeLinks', {
  filter: (node) => node.nodeName === 'A' && Boolean((node as HTMLElement).getAttribute('href')),
  replacement: (content, node) => {
    const href = (node as HTMLElement).getAttribute('href')!.trim();
    const text = content.trim();
    if (!/^(?:https?:|mailto:)/i.test(href)) return text;
    return text && text !== href ? `[${text}](${href})` : `<${href}>`;
  },
});

const formatAddresses = (value?: AddressObject | AddressObject[]) => {
  const lists = value ? (Array.isArray(value) ? value : [value]) : [];
  return lists
    .flatMap((list) => list.value)
    .flatMap((entry) => (entry.group ? entry.group : [entry]))
    .filter((entry) => entry.address)
    .map((entry) => (entry.name ? `${entry.name} <${entry.address}>` : entry.address!))
    .join(', ');
};

const firstAddress = (value?: AddressObject | AddressObject[]) => {
  const list = value ? (Array.isArray(value) ? value[0] : value) : undefined;
  const entry = list?.value.find((item) => item.address);
  return entry ? { address: entry.address!, name: entry.name || '' } : undefined;
};

// mailparser folds Importance, Priority and X-(MS)Priority into one `priority` header
const importanceOf = (headers: Map<string, unknown>): IParsedEmail['importance'] => {
  const priority = headers.get('priority');
  return priority === 'high' || priority === 'low' ? priority : 'normal';
};

export const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Inline images belong to the HTML body, which is not kept; the rest are real attachments. */
const isRealAttachment = (attachment: Attachment) =>
  !attachment.related && attachment.contentDisposition !== 'inline';

export const htmlToMarkdown = (html: string) =>
  turndown
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const parseEmail = async (raw: Buffer): Promise<IParsedEmail> => {
  const mail = await simpleParser(raw, {
    skipHtmlToText: false,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  });
  const text = (mail.text ?? '').trim();
  const body = mail.html ? htmlToMarkdown(mail.html) : text;
  const attachments = mail.attachments.filter(isRealAttachment);
  const referencesInReplyTo = Array.isArray(mail.references)
    ? mail.references.at(-1)
    : mail.references;
  return {
    subject: (mail.subject ?? '').trim() || '(no subject)',
    from: firstAddress(mail.from),
    to: formatAddresses(mail.to),
    cc: formatAddresses(mail.cc),
    bcc: formatAddresses(mail.bcc),
    replyTo: formatAddresses(mail.replyTo),
    sentAt: mail.date,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo ?? referencesInReplyTo,
    body: truncate(body, BODY_MAX_LENGTH),
    snippet: truncate((text || body).replace(/\s+/g, ' ').trim(), SNIPPET_LENGTH),
    importance: importanceOf(mail.headers),
    attachments: attachments.slice(0, MAX_ATTACHMENTS).map((attachment) => ({
      filename: attachment.filename || 'attachment',
      contentType: attachment.contentType || 'application/octet-stream',
      size: attachment.size,
      content: attachment.content,
    })),
    hasAttachments: attachments.length > 0,
  };
};
