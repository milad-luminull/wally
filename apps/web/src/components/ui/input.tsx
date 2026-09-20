import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-14 text-fg-1 outline-none transition-colors duration-150',
      'placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-55',
      'focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
