import { Skel } from './ui.js';

function PanelRows({
  titleWidth,
  rows,
  cells,
}: {
  titleWidth: number;
  rows: number;
  cells: number[];
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <Skel width={titleWidth} height={16} />
      </div>
      <div className="panel-body flex flex-col gap-3">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-3">
            {cells.map((w, i) => (
              <Skel key={i} width={w} height={12} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Placeholder for the global Overview while its first load (or a range switch) runs. */
export default function GlobalOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="stat-tiles">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat-tile flex flex-col gap-2">
            <Skel width={70} height={12} />
            <Skel width={50} height={28} />
          </div>
        ))}
      </div>

      <Skel width="100%" height={340} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PanelRows titleWidth={80} rows={4} cells={[140, 50, 60]} />
        <PanelRows titleWidth={120} rows={4} cells={[60, 100, 50]} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <PanelRows titleWidth={100} rows={3} cells={[20, 100, 50, 60]} />
        <PanelRows titleWidth={90} rows={3} cells={[20, 100, 50, 60]} />
      </div>
    </div>
  );
}
