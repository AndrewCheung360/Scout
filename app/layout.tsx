import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Scout',
  description: 'Research the right product to buy — cited, trust-scored, and watchable.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
