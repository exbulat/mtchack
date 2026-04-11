import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { api } from '../lib/api';

export default function GraphView() {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function renderGraph() {
      try {
        const data = await api.getGraph();
        if (!mounted || !ref.current) return;

        const svg = d3.select(ref.current);
        svg.selectAll('*').remove();

        const width = ref.current.clientWidth || 800;
        const height = ref.current.clientHeight || 600;

        const simulation = d3
          .forceSimulation(data.nodes as any)
          .force('link', d3.forceLink(data.edges as any).id((d: any) => d.id).distance(90))
          .force('charge', d3.forceManyBody().strength(-250))
          .force('center', d3.forceCenter(width / 2, height / 2));

        const links = svg
          .append('g')
          .selectAll('line')
          .data(data.edges)
          .join('line')
          .attr('stroke', '#cfcfd4')
          .attr('stroke-width', 1.2);

        const nodes = svg
          .append('g')
          .selectAll('circle')
          .data(data.nodes)
          .join('circle')
          .attr('r', 10)
          .attr('fill', '#2563eb');

        const labels = svg
          .append('g')
          .selectAll('text')
          .data(data.nodes)
          .join('text')
          .text((d: any) => d.title)
          .attr('font-size', 11)
          .attr('dx', 12)
          .attr('dy', 4)
          .attr('fill', '#1a1a1a');

        simulation.on('tick', () => {
          links
            .attr('x1', (d: any) => d.source.x)
            .attr('y1', (d: any) => d.source.y)
            .attr('x2', (d: any) => d.target.x)
            .attr('y2', (d: any) => d.target.y);
          nodes.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);
          labels.attr('x', (d: any) => d.x).attr('y', (d: any) => d.y);
        });
      } catch {
        // noop
      }
    }

    renderGraph();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="graph-container">
      <svg ref={ref} />
    </div>
  );
}
