import { IBM_Plex_Sans, Martian_Mono, Tektur } from 'next/font/google';

/** The cockpit's three faces (cockpit design §5.7), self-hosted by next/font at build time. */
const tektur = Tektur({ subsets: ['latin'], variable: '--font-tektur', display: 'swap' });
const martian = Martian_Mono({
  subsets: ['latin'],
  variable: '--font-martian',
  display: 'swap',
  axes: ['wdth'],
});
const plex = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

/** Class names that define the font variables on the cockpit root. */
export const cockpitFonts = [tektur.variable, martian.variable, plex.variable].join(' ');
