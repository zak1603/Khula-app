import { cn } from '@/lib/utils';

const BEADS = ['bg-bead-green flex-[2]', 'bg-bead-gold flex-1', 'bg-bead-red flex-1', 'bg-bead-blue flex-1', 'bg-bead-black flex-1'];

/** Khula's signature: a thin beadwork band (Zulu/Ndebele-inspired). Decorative only. */
export function BeadStripe({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex h-1 gap-1', className)}>
      {BEADS.map((b) => (
        <span key={b} className={cn('rounded-full', b)} />
      ))}
    </div>
  );
}
