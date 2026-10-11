/** Kept separate from alert-dialog.tsx so the fast-refresh lint rule doesn't flag a
 * non-component export living alongside components in the same file. */
export function buttonVariantsForAlertAction(variant: 'default' | 'destructive'): string {
  const base =
    'inline-flex h-9 items-center justify-center rounded-md px-4 text-14 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] disabled:pointer-events-none disabled:opacity-55';
  if (variant === 'destructive') {
    return `${base} bg-destructive text-destructive-foreground hover:bg-[color:var(--destructive-hover)]`;
  }
  return `${base} bg-primary text-primary-foreground hover:bg-primary-hover`;
}
