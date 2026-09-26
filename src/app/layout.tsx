import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Saltor — know what you're worth",
  description:
    "Anonymous salary data for India. See the real market rate for your role, whether your raise beat inflation, and whether to ask for more or move.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="inner">
            <Link href="/" className="logo">
              sal<span>tor</span>
            </Link>
            <nav>
              <Link href="/">Check my pay</Link>
              <Link href="/explore">Explore data</Link>
              <Link href="/about">How it works</Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="site">
          <div className="inner">
            <p>
              Saltor shows aggregated, anonymous salary reports. Nothing you submit is linked to
              you, and no figure shown here is advice about a specific employer. Inflation figures
              are India CPI (Combined) reference values from MoSPI/RBI.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
