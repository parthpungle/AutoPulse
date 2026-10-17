// 03 / Engine cycle: the dial in its panel, with what it can and cannot claim.
import Dial from './Dial.jsx';

export default function Cycle({ fold, dev, base, where, ctxWords }) {
  return (
    <section id="lab-cycle" tabIndex={-1} className="panel panel-pad lab-cycle" aria-labelledby="lab-cycle-title">
      <div className="row">
        <h2 className="eyebrow lab-eyebrow" id="lab-cycle-title"><span className="num">03</span> / Engine cycle</h2>
        <div className="spacer" />
        <span className="lab-tag">estimated · cylinder mapping unavailable</span>
      </div>
      <div className="lab-cycle__dial">
        <Dial fold={fold} dev={dev} base={base} peak={where.peak} weak={where.weak} summary={`Engine cycle, 720 degrees. ${where.text}`} />
      </div>
      <p className="lab-cycle__where">{where.text}</p>
      <p className="chart-caption">
        Energy per 6° of crank from the first 200 ms of this second (4 kHz), folded with rpm; 0° = the first firing found.
        F1–F4: firings in order, with mean crank-speed change. No crank or cam reference in the stream, so cylinders can't be named.
        {base ? ` Band: normal per firing, ${base.n} healthy s (${ctxWords}).` : ' Learning this car\'s normal per firing.'}
      </p>
    </section>
  );
}
