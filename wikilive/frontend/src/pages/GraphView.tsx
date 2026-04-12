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

        type GraphNode = { id: string; title: string; icon: string } & d3.SimulationNodeDatum;
        type GraphLink = d3.SimulationLinkDatum<GraphNode>;

        const simNodes: GraphNode[] = data.nodes.map((n) => ({ ...n }));
        const simLinks: GraphLink[] = data.edges.map((e) => ({ source: e.source, target: e.target }));

        const simulation = d3
          .forceSimulation<GraphNode>(simNodes)
          .force('link', d3.forceLink<GraphNode, GraphLink>(simLinks).id((d) => d.id).distance(90))
          .force('charge', d3.forceManyBody().strength(-250))
          .force('center', d3.forceCenter(width / 2, height / 2));

        const links = svg
          .append('g')
          .selectAll('line')
          .data(simLinks)
          .join('line')
          .attr('stroke', '#cfcfd4')
          .attr('stroke-width', 1.2);

        const nodes = svg
          .append('g')
          .selectAll('circle')
          .data(simNodes)
          .join('circle')
          .attr('r', 10)
          .attr('fill', '#2563eb');

        const labels = svg
          .append('g')
          .selectAll('text')
          .data(simNodes)
          .join('text')
          .text((d) => d.title)
          .attr('font-size', 11)
          .attr('dx', 12)
          .attr('dy', 4)
          .attr('fill', '#1a1a1a');

        simulation.on('tick', () => {
          links
            .attr('x1', (d) => (d.source as GraphNode).x ?? 0)
            .attr('y1', (d) => (d.source as GraphNode).y ?? 0)
            .attr('x2', (d) => (d.target as GraphNode).x ?? 0)
            .attr('y2', (d) => (d.target as GraphNode).y ?? 0);
          nodes.attr('cx', (d) => d.x ?? 0).attr('cy', (d) => d.y ?? 0);
          labels.attr('x', (d) => d.x ?? 0).attr('y', (d) => d.y ?? 0);
        });
      } catch { /* ignore */ }
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
