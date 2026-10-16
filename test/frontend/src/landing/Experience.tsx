import { useEffect, useRef } from 'react';
import { Experience as Engine } from '../experience/Experience';

interface Props {
  onCreate: (engine: Engine) => void;
  onProgress: (p: number) => void;
  onSection: (index: number) => void;
  onCard: (index: number) => void;
  onStage: (index: number) => void;
  onOpenCard: (index: number) => void;
}

/** Mounts the WebGL engine behind the page: created on mount, disposed (with every GPU resource) on unmount. */
export function Experience({ onCreate, onProgress, onSection, onCard, onStage, onOpenCard }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onCreate, onProgress, onSection, onCard, onStage, onOpenCard });
  cb.current = { onCreate, onProgress, onSection, onCard, onStage, onOpenCard };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-section]'));
    const engine = Engine.create(el, {
      sections,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      onProgress: (p) => cb.current.onProgress(p),
      onSection: (i) => cb.current.onSection(i),
      onCard: (i) => cb.current.onCard(i),
      onStage: (i) => cb.current.onStage(i),
      onOpenCard: (i) => cb.current.onOpenCard(i),
    });
    cb.current.onCreate(engine);
    return () => engine.dispose();
  }, []);

  return <div ref={host} className="tt-canvas" aria-hidden="true" />;
}
