import * as React from 'react';
import { cn } from '@/lib/cn';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full resize-none rounded-md border border-transparent bg-transparent px-0 py-1 text-14 text-fg-1 outline-none transition-colors duration-150',
      'placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-55',
      'focus-visible:ring-0',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
