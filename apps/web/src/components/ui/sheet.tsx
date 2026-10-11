import * as React from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-overlay bg-[color:var(--scrim)] backdrop-blur-[2px]',
      'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

/* Keyframed, not transitioned: Radix keeps the node mounted only while a CSS *animation*
 * is running, so a `data-[state=closed]` transition never gets a chance to play. */
const sheetVariants = cva('fixed z-overlay flex flex-col gap-0 bg-card shadow-e3', {
  variants: {
    side: {
      right:
        'inset-y-0 right-0 h-full w-full max-w-sm border-l border-border data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
      bottom:
        'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t border-border data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
    },
  },
  defaultVariants: { side: 'right' },
});

interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideClose?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, hideClose, ...props }, ref) => {
  // See the note in dialog.tsx — the close button's name is the only copy here.
  const { t } = useTranslation();

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {side === 'bottom' && (
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border-strong"
          />
        )}
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label={t('common.close')}
            className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors duration-150 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = DialogPrimitive.Content.displayName;

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 border-b border-border p-5', className)} {...props} />
  );
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('font-head text-22 font-semibold text-fg-1', className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-14 text-fg-muted', className)}
    {...props}
  />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
