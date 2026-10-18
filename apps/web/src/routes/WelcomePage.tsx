import { Link } from 'react-router';
import { Check, CheckCheck, List, MoveUpRight, PencilLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PublicHeader } from '@/components/PublicHeader';

export function WelcomePage() {
  const { t } = useTranslation();
  const cards = ['call', 'slides', 'weekend', 'idea', 'done'] as const;
  const moments = ['capture', 'organise', 'review'] as const;
  const icons = [PencilLine, List, CheckCheck];
  return (
    <div className="welcome-page">
      <PublicHeader showAuth />
      <main>
        <section className="welcome-hero">
          <div className="welcome-intro">
            <p className="welcome-context">{t('welcome.context')}</p>
            <h1>{t('welcome.headline')}</h1>
            <p className="welcome-description">{t('welcome.description')}</p>
            <Link to="/signup" className="welcome-cta">
              {t('welcome.start')}
              <MoveUpRight aria-hidden size={18} />
            </Link>
            <p className="welcome-note">{t('welcome.note')}</p>
          </div>
          <div className="welcome-wall" role="img" aria-label={t('welcome.preview')}>
            <div className="welcome-wall-label">
              <span className="welcome-wall-dot" />
              {t('welcome.sample')}
            </div>
            {cards.map((key, i) => (
              <div key={key} className={`welcome-paper welcome-paper-${i}`}>
                <span className="welcome-paper-check">{key === 'done' && <Check size={13} />}</span>
                <div>
                  <h2>{t(`welcome.cards.${key}.title`)}</h2>
                  <p>{t(`welcome.cards.${key}.body`)}</p>
                  <span className="welcome-paper-meta">{t(`welcome.cards.${key}.meta`)}</span>
                </div>
              </div>
            ))}
            <div className="welcome-wall-caption">{t('welcome.previewCaption')}</div>
          </div>
        </section>
        <section className="welcome-moments" aria-label={t('welcome.how')}>
          {moments.map((key, i) => {
            const Icon = icons[i]!;
            return (
              <article key={key}>
                <Icon aria-hidden size={23} strokeWidth={1.5} />
                <h2>{t(`welcome.moments.${key}.title`)}</h2>
                <p>{t(`welcome.moments.${key}.body`)}</p>
              </article>
            );
          })}
        </section>
        <section className="welcome-closing">
          <h2>{t('welcome.closing')}</h2>
          <Link to="/signup" className="welcome-cta">
            {t('welcome.start')}
            <MoveUpRight aria-hidden size={18} />
          </Link>
        </section>
      </main>
      <footer className="welcome-footer">
        <span>
          {t('welcome.brand')} <span className="text-fg-3">{t('welcome.byline')}</span>
        </span>
        <span>{t('welcome.footer')}</span>
      </footer>
    </div>
  );
}
