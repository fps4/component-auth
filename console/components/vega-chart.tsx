'use client';

import { useEffect, useRef } from 'react';
import embed, { type VisualizationSpec } from 'vega-embed';

/** Thin client wrapper around vega-embed for the dashboard charts (SVG renderer, no toolbar). */
export function VegaChart({ spec }: { spec: VisualizationSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let view: { finalize: () => void } | undefined;
    embed(ref.current, spec, { actions: false, renderer: 'svg' })
      .then((r) => { view = r.view; })
      .catch(() => {});
    return () => view?.finalize();
  }, [spec]);
  return <div ref={ref} className="w-full" />;
}
