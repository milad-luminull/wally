import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer relative h-[18px] w-[18px] shrink-0 rounded-[6px] border border-border-strong bg-card transition-colors duration-150',
      /* The box stays 18px — it sits against 14px text and a bigger one would shout — but
         18px is under the 24px SC 2.5.8 floor, so an invisible ::after carries the target
         out to 24px, and to 36px on a touch pointer. Not the full 44px: in a note row the
         checkbox sits 14px from the title and a 44px target would start swallowing taps
         meant to open the note. */
      'after:absolute after:-inset-[3px] after:rounded-lg after:content-[""]',
      '[@media(pointer:coarse)]:after:-inset-[9px]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
      'disabled:cursor-not-allowed disabled:opacity-55',
      'data-[state=checked]:border-[color:var(--status-success-bold)] data-[state=checked]:bg-[color:var(--status-success-bold)]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
      <Check className="h-3 w-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
