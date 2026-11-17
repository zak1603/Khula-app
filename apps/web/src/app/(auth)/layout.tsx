import { CalendarCheck2, ShieldCheck, Sprout, Wallet } from 'lucide-react';
import { BeadStripe } from '@/components/ui/bead-stripe';

const POINTS = [
  { icon: CalendarCheck2, text: 'Bookings, walk-ins and quotes in one calendar' },
  { icon: Wallet, text: 'Deposits paid upfront in rand, straight to your account' },
  { icon: ShieldCheck, text: 'POPIA-compliant from day one' },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <aside className="bg-diamonds relative flex flex-col justify-between overflow-hidden bg-brand-900 px-6 py-8 text-white sm:px-10 lg:px-14 lg:py-12">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sun-400">
            <Sprout className="h-5 w-5 text-brand-900" aria-hidden />
          </span>
          <span className="text-xl font-extrabold tracking-tight">Khula</span>
          <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sun-300">Business</span>
        </div>

        <div className="my-10 max-w-lg lg:my-0">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-sun-400">Sawubona · Molo · Dumela · Hallo</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-[1.1] tracking-tightest sm:text-5xl">
            Grow your business, <span className="text-sun-400">the Mzansi way.</span>
          </h1>
          <p className="mt-4 text-base text-brand-100/90">
            From salons in Soweto to plumbers in Stellenbosch — Khula helps local pros fill their diaries and get paid.
          </p>
          <ul className="mt-8 hidden space-y-3 sm:block">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-brand-50">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-4 w-4 text-sun-300" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <BeadStripe className="max-w-xs" />
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center bg-sand-50 p-4 sm:p-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
