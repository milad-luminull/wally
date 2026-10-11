import * as React from 'react';
import { cn } from '@/lib/cn';
import { fieldClassName } from './field-styles';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input type={type} ref={ref} className={cn(fieldClassName, className)} {...props} />
));
Input.displayName = 'Input';
