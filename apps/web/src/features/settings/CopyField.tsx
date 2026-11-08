import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** A read-only value to paste somewhere else, with a button that copies it. */
export function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard blocked: the field is still selectable by hand.
      document.getElementById(id)?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          className="min-w-0 flex-1"
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={t('settings.copy', { label })}
          title={t('settings.copy', { label })}
          onClick={() => void copy()}
        >
          <Copy aria-hidden />
        </Button>
      </div>
      <p role="status" className="min-h-[1rem] text-12 text-fg-3">
        {copied ? t('settings.copied') : ''}
      </p>
    </div>
  );
}
