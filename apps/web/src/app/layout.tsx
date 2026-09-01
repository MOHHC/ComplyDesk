import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

/*
 * Plex, not Inter or Jakarta: drawn for an engineering company, rational
 * with a little idiosyncrasy, and — unusually — with a first-class mono
 * in the same superfamily.
 *
 * The split is the point. Sans carries prose; mono is reserved for values
 * that are *records* — control codes, dates, counts, percentages,
 * workspace slugs (a slug is a URL). The typography itself marks what is
 * evidence and what is commentary.
 */
const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ComplyDesk',
  description: 'Compliance control tracking for growing teams.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
