import { forwardRef, useState } from 'react';
import { DEMO_WORDS } from './demo';

/** One group per colour, from the lists demoNote parses: day, person, time, urgency, idea. */
const tokens = new RegExp(
  [
    `(\\b(?:${DEMO_WORDS.day})\\b)`,
    `(\\b(?:${DEMO_WORDS.person})\\b)`,
    `(\\b(?:${DEMO_WORDS.clock})\\b|\\b(?:${DEMO_WORDS.duration})\\b)`,
    `(\\b(?:${DEMO_WORDS.urgency})\\b)`,
    // An idea is the first word, as demoNote reads it, with the colon when there is one.
    `(^(?:${DEMO_WORDS.idea})\\b:?)`,
  ].join('|'),
  'gi',
);

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
      colour: match[1] ? 'oat' : match[2] ? 'sky' : match[3] ? 'mint' : 'rose',
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
