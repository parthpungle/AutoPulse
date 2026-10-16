// One-glance state of the link to the vehicle: colour + icon + words, never colour alone.
import { CircleDot, Link2Off, LoaderCircle, OctagonAlert, TriangleAlert } from 'lucide-react';
import { useLive } from '../live.jsx';
import { carName } from '../cars.js';

export function linkView({ link, live, stale, api }) {
  if (api === 'closed') return { tone: 'critical', Icon: OctagonAlert, text: 'Dashboard API offline' };
  if (live) return { tone: 'good', Icon: CircleDot, text: `Live · ${carName(link.vehicle?.car_type)}`, pulse: true };
  if (stale) return { tone: 'warning', Icon: TriangleAlert, text: 'No data from the vehicle' };
  if (link.state === 'connecting' || link.state === 'lost') return { tone: 'warning', Icon: LoaderCircle, text: link.state === 'lost' ? 'Reconnecting…' : 'Connecting…', spin: true };
  if (link.state === 'error') return { tone: 'critical', Icon: OctagonAlert, text: "Couldn't connect" };   // the reason is in the drawer
  return { tone: 'muted', Icon: Link2Off, text: 'Connect a vehicle' };
}

export function LinkPill({ onClick }) {
  const live = useLive();
  const { tone, Icon, text, pulse, spin } = linkView(live);
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className={`link-pill ${tone}`} onClick={onClick} title={live.link.host ? `${live.link.host}:${live.link.port}` : undefined}>
      <Icon size={15} strokeWidth={2} className={spin ? 'spin' : pulse ? 'pulse-ico' : ''} />
      <span>{text}</span>
      {live.live && live.link.latency_ms != null && <small>{live.link.latency_ms} ms</small>}
    </Tag>
  );
}
