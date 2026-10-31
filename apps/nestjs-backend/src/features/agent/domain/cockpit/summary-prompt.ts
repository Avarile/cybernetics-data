/** The record the summarizer reads is cut here (characters). */
export const SUMMARY_INPUT_MAX = 12_000;

/** Scope design §8.3: a summary that is read out loud. */
export const SUMMARY_SYSTEM = [
  'You brief the owner of a personal database on one of its records.',
  'Summarize the record you are given in at most 3 sentences and 60 words.',
  'Write plain text to be spoken aloud: no Markdown, no lists, no headings, no emoji.',
  'Use the language the record is written in.',
  'Say what the record is and the facts that matter most. Do not repeat field names one by one.',
  'Never read out values shown as ••••••, credentials, tokens or keys.',
].join(' ');

export const summaryPrompt = (markdown: string) =>
  markdown.length > SUMMARY_INPUT_MAX ? `${markdown.slice(0, SUMMARY_INPUT_MAX)}…` : markdown;

/** Model output as one spoken paragraph: Markdown marks and line breaks gone. */
export const spokenText = (text: string) =>
  text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
