import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'ClaimWatch — claim-evolution radar',
  description:
    'Patent claim-evolution dossiers where every assertion is mechanically checkable against the canonical USPTO document, claim number, and date.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
