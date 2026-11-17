import type { Metadata } from 'next';
import { RETENTION_DAYS } from '@khula/shared';

export const metadata: Metadata = { title: 'Privacy notice' };

/**
 * POPIA s18 notification. Have this reviewed by your Information Officer /
 * legal counsel before launch — it describes what the system actually does.
 */
export default function PrivacyPage() {
  return (
    <article className="prose prose-slate mx-auto max-w-2xl space-y-4 p-8 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold">Privacy notice</h1>
      <p>Khula (&quot;we&quot;) processes personal information in line with the Protection of Personal Information Act, 2013 (POPIA).</p>
      <h2 className="text-lg font-semibold">What we collect and why</h2>
      <ul className="list-disc pl-5">
        <li>Name, email and phone — to create your account and let providers contact you about bookings.</li>
        <li>Job-site address (mobile services only) — so the provider can get to you. Deleted {RETENTION_DAYS.jobSiteAddress} days after the job.</li>
        <li>Payment records — handled by Paystack/PayFast; we never see your card number. Ledger entries are kept {RETENTION_DAYS.financialRecords / 365} years as required by tax law.</li>
        <li>Saved cards — only a provider token and the last 4 digits, encrypted, and only if you opt in.</li>
      </ul>
      <h2 className="text-lg font-semibold">Your rights</h2>
      <p>
        You can download all data we hold about you or delete your account at any time from the app (Profile → Privacy). You may also contact our
        Information Officer or lodge a complaint with the Information Regulator (inforegulator.org.za).
      </p>
      <h2 className="text-lg font-semibold">Security</h2>
      <p>Data is encrypted in transit and at rest, access is restricted per business, sensitive notes are separately encrypted, and every access to them is logged.</p>
    </article>
  );
}
