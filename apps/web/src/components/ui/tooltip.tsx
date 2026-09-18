import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-tooltip overflow-hidden rounded-md bg-[color:var(--petrol-dark)] px-2.5 py-1.5 text-12 font-medium text-white shadow-e2',
        'origin-[var(--radix-tooltip-content-transform-origin)] scale-95 opacity-0 transition duration-150 ease-ds',
        'data-[state=delayed-open]:scale-100 data-[state=delayed-open]:opacity-100 data-[state=instant-open]:scale-100 data-[state=instant-open]:opacity-100',
        'motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/** Convenience wrapper: icon-only buttons always need both a tooltip and an aria-label. */
export function IconTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
