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
        'z-tooltip overflow-hidden rounded-md bg-tooltip px-2 py-1 text-12 font-medium text-tooltip-foreground shadow-e2',
        'origin-[var(--radix-tooltip-content-transform-origin)]',
        'data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in data-[state=closed]:animate-pop-out',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

/** Convenience wrapper: icon-only buttons always need both a tooltip and an aria-label. */
export function IconTooltip({
  label,
  shortcut,
  children,
}: {
  label: string;
  /** Keys shown after the label, e.g. `['N']` or `['⌘', 'K']`. */
  shortcut?: string[];
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        {shortcut && (
          <span className="flex gap-0.5 opacity-70" aria-hidden>
            {shortcut.map((key) => (
              <kbd key={key} className="font-mono text-[11px]">
                {key}
              </kbd>
            ))}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
