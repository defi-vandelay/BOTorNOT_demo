import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BOT or NOT',
  description: 'Chat for two minutes, then call it: human or AI?',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
