import { forwardRef, useState } from 'react';

const tokens =
  /(\b(?:today|tomorrow|next week|mon\w*|tue\w*|wed\w*|thu\w*|fri\w*|heute|morgen|mo|di|mi|do|fr|donnerstag|freitag)\b)|(\b(?:maya|leo|sam)\b)|(\b\d{1,2}(?::\d{2})?\s?(?:am|pm|uhr)\b|\b\d+\s?(?:m|min|h)\b)|(\b(?:urgent|asap|important|dringend|wichtig)\b)|(^idea:|^idee:)/gi;

export const DemoInput = forwardRef<
  HTMLInputElement,
  {
    value: string;
    label: string;
    placeholder: string;
    onFocus: () => void;
    onChange: (value: string) => void;
  }
>(function DemoInput({ value, label, placeholder, onFocus, onChange }, ref) {
  const [scroll, setScroll] = useState(0);
  const segments: { text: string; colour?: string }[] = [];
  let start = 0;
  for (const match of value.matchAll(tokens)) {
    if (match.index > start) segments.push({ text: value.slice(start, match.index) });
    segments.push({
      text: match[0],
      colour: match[1] ? 'butter' : match[2] ? 'himmel' : match[3] ? 'minze' : 'rose',
    });
    start = match.index + match[0].length;
  }
  if (start < value.length) segments.push({ text: value.slice(start) });
  return (
    <div className="landing-demo-input-field">
      <div className="landing-demo-input-ink" aria-hidden>
        <div style={{ transform: `translateX(-${scroll}px)` }}>
          {segments.map((segment, i) => (
            <span key={i} data-colour={segment.colour}>
              {segment.text}
            </span>
          ))}
        </div>
      </div>
      <input
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        maxLength={240}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => setScroll(event.currentTarget.scrollLeft)}
      />
    </div>
  );
});
