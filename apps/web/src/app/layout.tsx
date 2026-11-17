import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Khula for Business', template: '%s · Khula' },
  description: 'Bookings, quotes, staff and payments for South African service businesses.',
  robots: { index: false, follow: false }, // dashboard is private
};

export const viewport: Viewport = { themeColor: '#146b4f', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the nonce opts every page into dynamic rendering so Next.js can
  // stamp it on its inline bootstrap scripts (strict CSP, no 'unsafe-inline').
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en-ZA">
      <body className="min-h-screen font-sans" nonce={nonce}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
