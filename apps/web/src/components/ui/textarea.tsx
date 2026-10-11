import * as React from 'react';
import { cn } from '@/lib/cn';
import { fieldClassName } from './field-styles';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(fieldClassName, 'h-auto min-h-16 resize-none py-1.5', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
