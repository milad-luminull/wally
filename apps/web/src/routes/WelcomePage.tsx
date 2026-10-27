import { useState } from 'react';
import { Link } from 'react-router';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { PublicHeader } from '@/components/PublicHeader';
import { BrandMark } from '@/components/BrandMark';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { LandingDemo } from '@/features/landing/LandingDemo';
import { LandingViews } from '@/features/landing/LandingViews';
import { LandingVoice } from '@/features/landing/LandingVoice';

function CaptureIllustration() {
  const { t } = useTranslation();
  return (
    <div className="landing-step-art landing-capture-art" aria-hidden>
      <div className="landing-capture-tags">
        {['oat', 'sky', 'rose', 'mint'].map((colour, i) => (
          <span key={colour} data-colour={colour}>
            {t('landing.captureKinds', { returnObjects: true })[i]}
          </span>
        ))}
      </div>
      <div className="landing-capture-example">
        {t('landing.captureExample')}
        <i className="landing-caret" />
      </div>
    </div>
  );
}
function SortIllustration() {
  const { t } = useTranslation();
  return (
    <div className="landing-step-art" aria-hidden>
      <div className="landing-demo-card-glow" data-working="true">
        <div className="landing-sort-example" data-colour="sky">
          <span>{t('landing.voiceCards.0.title')}</span>
          <div>
            <span>{t('landing.demo.days.fri')}</span>
            <span>{t('landing.demo.high')}</span>
            <span>{t('landing.demo.duration', { count: 20 })}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
function WeekIllustration() {
  const { t } = useTranslation();
  return (
    <div className="landing-step-art landing-week-art" aria-hidden>
      {(['today', 'tomorrow', 'next'] as const).map((key, i) => (
        <div key={key}>
          <span>{t(key === 'next' ? 'landing.views.week.label' : `landing.demo.days.${key}`)}</span>
          {[
            ['sky', 'oat', 'chalk'],
            ['mint', 'rose'],
            ['oat', 'sky', 'mint'],
          ][i]!.map((colour, n) => (
            <i key={n} data-colour={colour} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function WelcomePage() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  const [paused, setPaused] = useState(false);
  const [faq, setFaq] = useState<number | null>(0);
  const reducedMotion = useReducedMotion();
  const actionLabel = t(signedIn ? 'welcome.open' : 'welcome.start');
  const action =
    status === 'loading' ? (
      <button type="button" className="landing-pill landing-join-action" disabled>
        {actionLabel}
      </button>
    ) : (
      <Link to={signedIn ? '/boards' : '/signup'} className="landing-pill landing-join-action">
        {actionLabel}
      </Link>
    );
  const illustrations = [CaptureIllustration, SortIllustration, WeekIllustration];
  return (
    <div className="welcome-page landing-page" data-paused={paused || reducedMotion}>
      <a className="landing-skip" href="#landing-main">
        {t('landing.skip')}
      </a>
      <PublicHeader landing showAuth={status !== 'loading'} signedIn={signedIn} />
      <main id="landing-main">
        <section id="top" className="landing-hero">
          <div className="landing-floating-notes" aria-hidden>
            {['oat', 'sky', 'mint', 'rose'].map((colour, i) => (
              <span key={colour} data-colour={colour}>
                {t('landing.floating', { returnObjects: true })[i]}
              </span>
            ))}
          </div>
          <div className="landing-container landing-hero-content">
            <LandingDemo
              paused={paused}
              reducedMotion={reducedMotion}
              onTogglePause={() => setPaused((value) => !value)}
            />
            <h1>
              {t('landing.headline')}
              <br /> {t('landing.headlineNext')} <mark>{t('landing.headlineHighlight')}</mark>
            </h1>
            <p className="landing-description">{t('landing.description')}</p>
          </div>
        </section>
        <section id="how" className="landing-section landing-how">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t('landing.nav.how')}</span>
              <h2>{t('landing.howTitle')}</h2>
            </div>
            <div className="landing-steps">
              {illustrations.map((Illustration, i) => (
                <article key={i}>
                  <Illustration />
                  <div className="landing-step-copy">
                    <span className="landing-step-number">{String(i + 1).padStart(2, '0')}</span>
                    <h3>{t('landing.steps', { returnObjects: true })[i]!.title}</h3>
                    <p>{t('landing.steps', { returnObjects: true })[i]!.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="voice" className="landing-section">
          <div className="landing-container landing-voice">
            <div className="landing-voice-copy">
              <span className="landing-eyebrow">{t('landing.nav.voice')}</span>
              <h2>
                {t('landing.voiceTitle')}
                <br />
                {t('landing.voiceTitleNext')}
              </h2>
              <p>{t('landing.voiceBody')}</p>
            </div>
            <LandingVoice paused={paused} reducedMotion={reducedMotion} />
          </div>
        </section>
        <section id="views" className="landing-section">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t('landing.viewsLabel')}</span>
              <h2>{t('landing.viewsTitle')}</h2>
            </div>
            <LandingViews />
          </div>
        </section>
        <section className="landing-section">
          <div className="landing-container">
            <div className="landing-section-heading">
              <span>{t('landing.controlLabel')}</span>
              <h2>{t('landing.controlTitle')}</h2>
            </div>
            <div className="landing-control-cards">
              {['oat', 'sky', 'mint'].map((colour, i) => (
                <article key={colour} data-colour={colour}>
                  <h3>{t('landing.control', { returnObjects: true })[i]!.title}</h3>
                  <p>{t('landing.control', { returnObjects: true })[i]!.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section id="join" className="landing-section">
          <div className="landing-container landing-join">
            <span className="landing-join-note first" aria-hidden>
              {t('landing.joinNotes.0')}
            </span>
            <span className="landing-join-note last" aria-hidden>
              {t('landing.joinNotes.1')}
            </span>
            <h2>{t('landing.joinTitle')}</h2>
            <p>{t(signedIn ? 'landing.joinSignedIn' : 'landing.joinBody')}</p>
            {action}
            <small>{t('landing.joinNote')}</small>
          </div>
        </section>
        <section id="faq" className="landing-section">
          <div className="landing-faq">
            <h2>{t('landing.questions')}</h2>
            <div>
              {[0, 1, 2, 3].map((i) => (
                <article key={i}>
                  <h3>
                    <button
                      type="button"
                      aria-expanded={faq === i}
                      aria-controls={`landing-answer-${i}`}
                      id={`landing-question-${i}`}
                      onClick={() => setFaq((value) => (value === i ? null : i))}
                    >
                      {t('landing.faqs', { returnObjects: true })[i]!.question}
                      <Plus aria-hidden size={22} />
                    </button>
                  </h3>
                  <div
                    id={`landing-answer-${i}`}
                    role="region"
                    aria-labelledby={`landing-question-${i}`}
                    hidden={faq !== i}
                  >
                    <p>{t('landing.faqs', { returnObjects: true })[i]!.answer}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <div className="landing-container">
          <span className="landing-footer-brand">
            <BrandMark size={18} />
            {t('welcome.brand')} {t('welcome.byline')}
          </span>
          <a href="#how">{t('landing.nav.how')}</a>
          <a href="#faq">{t('landing.nav.faq')}</a>
          <span>{t('landing.copyright', { year: new Date().getFullYear() })}</span>
        </div>
      </footer>
    </div>
  );
}
