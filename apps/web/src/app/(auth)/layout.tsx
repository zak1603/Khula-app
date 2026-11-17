import { Sprout } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 via-white to-sun-400/10 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <Sprout className="h-7 w-7 text-brand-600" aria-hidden />
          <span className="text-2xl font-bold tracking-tight">Khula</span>
        </div>
        {children}
      </div>
    </div>
  );
}
