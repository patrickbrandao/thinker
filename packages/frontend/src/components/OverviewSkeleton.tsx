import { t } from '../i18n/index.js';
import { Panel, Skel, cx } from './ui.js';

/** Placeholder for the harness Overview while its first load (or a range/agent switch) runs. */
export default function OverviewSkeleton() {
  const stats: Array<[string, number]> = [
    [t('overview.chart.requests'), 50],
    [t('overview.chart.cost'), 80],
    [t('overview.chart.tokenUsage'), 70],
  ];
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <section className="panel overflow-hidden">
        <div className="grid grid-cols-3 border-b border-line">
          {stats.map(([label, width], i) => (
            <div
              key={label}
              className={cx(
                'flex flex-col gap-1 border-b-2 px-4 py-3',
                i === 0 ? 'border-accent' : 'border-transparent',
              )}
            >
              <span className="text-xs text-muted">{label}</span>
              <Skel width={width} height={28} />
            </div>
          ))}
        </div>
        <div className="p-4">
          <Skel width="100%" height={260} />
        </div>
      </section>

      <Panel
        title={t('overview.recentRequests')}
        actions={<span className="text-xs text-faint">{t('overview.viewMore')}</span>}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>{t('overview.skeleton.date')}</th>
                <th>{t('overview.skeleton.request')}</th>
                <th>{t('overview.skeleton.cost')}</th>
                <th>{t('overview.skeleton.model')}</th>
                <th>{t('overview.skeleton.tokens')}</th>
                <th>{t('overview.skeleton.status')}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((row) => (
                <tr key={row}>
                  {['70%', '50%', '50%', '70%', '40%', '50%'].map((w, i) => (
                    <td key={i}>
                      <Skel width={w} height={12} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={t('overview.skeleton.costByModel')}
        actions={<span className="panel-hint">{t('overview.skeleton.costByModelDesc')}</span>}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>{t('overview.skeleton.model')}</th>
                <th>{t('overview.skeleton.tokens')}</th>
                <th>{t('overview.modelUsage.pctOfTotal')}</th>
                <th>{t('overview.skeleton.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((row) => (
                <tr key={row}>
                  {['60%', '40%', '50%', '40%'].map((w, i) => (
                    <td key={i}>
                      <Skel width={w} height={12} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
