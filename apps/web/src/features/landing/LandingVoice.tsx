import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Waveform } from './LandingDemo';

export function LandingVoice({
  paused,
  reducedMotion,
}: {
  paused: boolean;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setInterval(() => setTick((value) => (value + 1) % 220), 90);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion]);
  const transcript = t('landing.voiceTranscript');
  const progress = reducedMotion ? transcript.length : Math.max(0, tick - 10);
  return (
    <div className="landing-voice-demo" role="img" aria-label={transcript}>
      <div className="landing-voice-demo-header" aria-hidden>
        <span className="landing-mini-bot">
          <i />
          <i />
        </span>
        <span>{t('landing.voiceListening')}</span>
        <Waveform />
      </div>
      <p className="landing-transcript" aria-hidden>
        {transcript.slice(0, progress)}
        <i className="landing-caret" />
      </p>
      <div className="landing-voice-cards" aria-hidden>
        {([0, 1, 2] as const)
          .filter((i) => progress >= transcript.length * [0.35, 0.62, 0.92][i]!)
          .map((i) => (
            <div key={i} data-colour={['butter', 'minze', 'himmel'][i]}>
              <span className="landing-check" />
              <span>{t(`landing.voiceCards.${i}.title`)}</span>
              <small>{t(`landing.voiceCards.${i}.meta`)}</small>
            </div>
          ))}
      </div>
    </div>
  );
}
