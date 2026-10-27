import { useEffect, useReducer, useRef, useState, type CSSProperties } from 'react';
import { DemoInput } from './DemoInput';
import { Mic, Pause, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { demoNote, demoReducer, initialDemo, type Tray } from './demo';

export function Waveform({ bars = 20 }: { bars?: number }) {
  return (
    <span className="landing-wave" aria-hidden>
      {Array.from({ length: bars }, (_, i) => (
        <i
          key={i}
          style={{ animationDelay: `${i * 0.06}s`, animationDuration: `${0.7 + (i % 5) * 0.13}s` }}
        />
      ))}
    </span>
  );
}

export function LandingDemo({
  paused,
  onTogglePause,
  reducedMotion,
}: {
  paused: boolean;
  onTogglePause: () => void;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const [state, dispatch] = useReducer(demoReducer, initialDemo);
  const [hello, setHello] = useState(false);
  const [eyes, setEyes] = useState({ x: 0, y: 0 });
  const bot = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const phrase = t('landing.demo.phrases', { returnObjects: true })[state.phrase]!;
  const note = demoNote(state.raw, t);
  const tray = note.tray;
  const playing = !paused && !reducedMotion;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick', phrase, tray }), 90);
    return () => window.clearInterval(timer);
  }, [playing, phrase, tray]);
  useEffect(() => {
    if (!hello) return;
    const timer = window.setTimeout(() => setHello(false), 1800);
    return () => window.clearTimeout(timer);
  }, [hello]);
  useEffect(() => {
    if (!playing) return;
    const follow = (event: MouseEvent) => {
      const rect = bot.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = event.clientX - rect.left - rect.width / 2;
      const dy = event.clientY - rect.top - rect.height / 2;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const scale = Math.min(1, distance / 260);
      setEyes({
        x: Math.round((dx / distance) * 9 * scale),
        y: Math.round((dy / distance) * 7 * scale),
      });
    };
    window.addEventListener('mousemove', follow, { passive: true });
    return () => window.removeEventListener('mousemove', follow);
  }, [playing]);
  const voice =
    state.phase === 'typing' && (state.voice || (!state.manual && [1, 4].includes(state.phrase)));
  const mood = hello
    ? 'hello'
    : voice
      ? 'voice'
      : state.phase === 'thinking'
        ? 'thinking'
        : state.phase === 'review'
          ? 'review'
          : state.phase === 'kept'
            ? 'kept'
            : state.manual
              ? 'listening'
              : 'ready';
  const hasCard = ['thinking', 'review', 'kept'].includes(state.phase);
  const reveal =
    state.phase === 'thinking' ? Math.max(0, 1 + Math.floor((state.elapsed - 800) / 280)) : 99;
  const text = state.manual ? state.input : phrase.slice(0, state.typed);
  const run = () => dispatch({ type: 'start', raw: text.trim() || phrase, instant: !playing });
  return (
    <section className="landing-demo" aria-label={t('landing.demo.label')}>
      <div className="landing-mascot">
        <button
          ref={bot}
          type="button"
          className="landing-bot"
          data-mood={hello ? 'hello' : state.phase}
          aria-label={t('landing.demo.poke')}
          onClick={() => setHello(true)}
        >
          <span className="landing-bot-shine" />
          <span className="landing-bot-cheek left" />
          <span className="landing-bot-cheek right" />
          <span
            className="landing-bot-eyes"
            style={{ '--eye-x': `${eyes.x}px`, '--eye-y': `${eyes.y}px` } as CSSProperties}
          >
            <i />
            <i />
          </span>
        </button>
        <span className="landing-bot-shadow" aria-hidden />
        <span className="landing-bot-mood">{t(`landing.demo.moods.${mood}`)}</span>
      </div>
      <div className="landing-demo-workspace">
        <div className="landing-demo-ring" data-working={hasCard || state.manual}>
          <form
            className="landing-demo-input"
            onSubmit={(event) => {
              event.preventDefault();
              run();
            }}
          >
            {voice && (
              <span className="landing-voice-input" aria-hidden>
                <Mic size={14} />
                <Waveform bars={6} />
              </span>
            )}
            <DemoInput
              ref={input}
              label={t('landing.demo.input')}
              placeholder={t('landing.demo.placeholder')}
              value={text}
              onFocus={() => dispatch({ type: 'focus' })}
              onChange={(value) => dispatch({ type: 'input', value })}
            />
            <button
              type="button"
              className="landing-mic"
              aria-label={t('landing.demo.voice')}
              title={t('landing.demo.voice')}
              onClick={() =>
                playing
                  ? dispatch({ type: 'voice' })
                  : dispatch({ type: 'start', raw: t('landing.demo.phrases.1'), instant: true })
              }
            >
              <Mic size={15} />
            </button>
            <button type="submit" className="landing-pill" aria-label={t('landing.demo.add')}>
              {t('landing.demo.add')}
              <span aria-hidden>↵</span>
            </button>
          </form>
        </div>
        <div className="landing-demo-stage">
          {hasCard ? (
            <div className="landing-demo-card-wrap" data-phase={state.phase} data-tray={note.tray}>
              <div className="landing-demo-card-glow" data-working={state.phase !== 'kept'}>
                <article className="landing-demo-card" data-colour={reveal ? note.colour : 'chalk'}>
                  <div className="landing-demo-title">
                    <span className="landing-check" />
                    <span>{reveal ? note.title : state.raw}</span>
                    {reveal > 0 && <small>{t(`landing.demo.kind.${note.kind}`)}</small>}
                  </div>
                  <dl>
                    {note.fields
                      .slice(1, 4)
                      .slice(0, Math.max(0, reveal - 1))
                      .map((field) => (
                        <div key={field.label}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                  </dl>
                  <ul>
                    {reveal > note.fields.length &&
                      note.subs.map((sub) => (
                        <li key={sub}>
                          <span />
                          {sub}
                        </li>
                      ))}
                  </ul>
                  <div className="landing-demo-review">
                    {state.phase === 'review' && (
                      <>
                        <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
                          <circle
                            cx="9"
                            cy="9"
                            r="7"
                            fill="none"
                            stroke="var(--border-strong)"
                            strokeWidth="2"
                          />
                          <circle
                            cx="9"
                            cy="9"
                            r="7"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeDasharray="43.98"
                            strokeDashoffset={(43.98 * state.elapsed) / 4050}
                            transform="rotate(-90 9 9)"
                          />
                        </svg>
                        <span>{t(playing ? 'landing.demo.saving' : 'landing.demo.review')}</span>
                        <button
                          type="button"
                          onClick={() => {
                            dispatch({ type: 'undo' });
                            input.current?.focus();
                          }}
                        >
                          {t('landing.demo.undo')}
                        </button>
                        <button
                          type="button"
                          className="landing-pill"
                          onClick={() =>
                            dispatch({ type: 'keep', tray: note.tray, instant: !playing })
                          }
                        >
                          {t('landing.demo.keep')}
                        </button>
                      </>
                    )}
                    {state.phase === 'thinking' && (
                      <span className="landing-shimmer">
                        {t(
                          reveal < 1
                            ? 'landing.demo.reading'
                            : reveal <= note.fields.length
                              ? 'landing.demo.details'
                              : 'landing.demo.steps',
                        )}
                      </span>
                    )}
                    {state.phase === 'kept' && <span>{t('landing.demo.saved')}</span>}
                  </div>
                </article>
              </div>
            </div>
          ) : (
            <div className="landing-demo-empty">
              {t(text ? 'landing.demo.waiting' : 'landing.demo.idle')}
            </div>
          )}
        </div>
        <div className="landing-demo-trays">
          {(['today', 'week', 'meet', 'ideas'] as Tray[]).map((key, i) => (
            <div key={key} data-active={state.phase === 'kept' && state.tray === key}>
              <i data-colour={['oat', 'mint', 'sky', 'rose'][i]} />
              <span>{t(`landing.demo.trays.${key}`)}</span>
              <output
                aria-label={t('landing.demo.trayCount', { name: t(`landing.demo.trays.${key}`) })}
              >
                {state.trays[key]}
              </output>
            </div>
          ))}
        </div>
        <div className="landing-demo-caption">
          <span>{t('landing.demo.note')}</span>
          {!reducedMotion && (
            <button
              type="button"
              aria-label={t(paused ? 'landing.demo.play' : 'landing.demo.pause')}
              title={t(paused ? 'landing.demo.play' : 'landing.demo.pause')}
              onClick={onTogglePause}
            >
              {paused ? <Play size={13} /> : <Pause size={13} />}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
