import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const views = ['week', 'priority', 'whiteboard', 'today', 'focus'] as const;
const notes = [
  { colour: 'oat', week: 1, priority: 1 },
  { colour: 'sky', week: 1, priority: 2 },
  { colour: 'oat', week: 1, priority: 2 },
  { colour: 'mint', week: 2, priority: 2 },
  { colour: 'sky', week: 3, priority: 2 },
  { colour: 'rose', week: 3, priority: 1 },
  { colour: 'chalk', week: 4, priority: 3 },
  { colour: 'mint', week: 4, priority: 3 },
];
const positions = [
  [4, 6, -3],
  [24, 30, 2],
  [8, 62, -1],
  [52, 8, 3],
  [70, 38, -2],
  [56, 70, 1],
  [28, 78, 2],
  [76, 64, -3],
];

export function LandingViews() {
  const { t } = useTranslation();
  const copy = t('landing.notes', { returnObjects: true });
  return (
    <Tabs defaultValue="week" className="landing-views">
      <TabsList aria-label={t('landing.nav.views')} className="landing-view-tabs">
        {views.map((view) => (
          <TabsTrigger key={view} value={view}>
            {t(`landing.views.${view}.label`)}
          </TabsTrigger>
        ))}
      </TabsList>
      {views.map((view) => (
        <TabsContent key={view} value={view} className="landing-view-panel">
          <p>{t(`landing.views.${view}.description`)}</p>
          <div className="landing-view-grid" data-view={view}>
            {notes.map((note, i) => {
              if ((view === 'today' && note.week !== 1) || (view === 'focus' && i !== 0))
                return null;
              const [x, y, rotation] = positions[i]!;
              return (
                <div
                  className="landing-view-note"
                  key={i}
                  data-colour={view === 'focus' ? 'sky' : note.colour}
                  style={
                    {
                      '--week': note.week,
                      '--priority': note.priority,
                      '--x': `${x}%`,
                      '--y': `${y}%`,
                      '--rotation': `${rotation}deg`,
                    } as CSSProperties
                  }
                >
                  <span>{copy[i]!.title}</span>
                  <small>{view === 'focus' ? t('landing.focusStep') : copy[i]!.meta}</small>
                </div>
              );
            })}
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
