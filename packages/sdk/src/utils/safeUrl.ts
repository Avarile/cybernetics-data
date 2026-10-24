const safeProtocols = ['http', 'https', 'mailto', 'tel'];

// Browsers drop control characters and whitespace when parsing a scheme,
// so `java\nscript:` still runs as `javascript:`.
const ignoredSchemeChars = /[\p{Cc}\s]/gu;
const schemePattern = /^([a-z][\d+.a-z-]*):/i;

export const isSafeUrl = (url?: string | null): url is string => {
  if (!url) return false;
  const scheme = schemePattern.exec(url.replace(ignoredSchemeChars, ''))?.[1];
  // No scheme means a relative URL, which stays on the current origin.
  return !scheme || safeProtocols.includes(scheme.toLowerCase());
};

export const getSafeUrl = (url?: string | null) => (isSafeUrl(url) ? url : undefined);
