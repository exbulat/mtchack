import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import { api } from '../lib/api';
import { useSpaces } from '../context/SpaceContext';

export default function GraphView() {
  const ref = useRef<SVGSVGElement | null>(null);
  const navigate = useNavigate();
  const { activeSpace } = useSpaces();

  useEffect(() => {
    let mounted = true;

    async function renderGraph() {
      try {
        const data = await api.getGraph(activeSpace?.id ?? null);
        if (!mounted || !ref.current) return;

        const svg = d3.select(ref.current);
        svg.selectAll('*').remove();

        const width = ref.current.clientWidth || 800;
        const height = ref.current.clientHeight || 600;

        type GraphNode = {
          id: string;
          title: string;
          icon: string;
          spaceId?: string | null;
        } & d3.SimulationNodeDatum;
        type GraphLink = d3.SimulationLinkDatum<GraphNode>;

        const simNodes: GraphNode[] = data.nodes.map((node) => ({ ...node }));
        const simLinks: GraphLink[] = data.edges.map((edge) => ({ source: edge.source, target: edge.target }));

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
          .attr('fill', '#2563eb')
          .style('cursor', 'pointer')
          .on('click', (_event, node) => {
            const href = node.spaceId
              ? `/spaces/${node.spaceId}/page/${node.id}`
              : `/page/${node.id}`;
            navigate(href);
          });

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
      } catch {
        if (ref.current) {
          d3.select(ref.current).selectAll('*').remove();
        }
      }
    }

    void renderGraph();

    return () => {
      mounted = false;
    };
  }, [activeSpace?.id, navigate]);

  return (
    <div className="graph-container">
      <div style={{ padding: '16px 20px 0', fontSize: 13, color: 'var(--text-secondary)' }}>
        {activeSpace ? `Граф связей пространства "${activeSpace.name}"` : 'Граф личных страниц'}
      </div>
      <svg ref={ref} />
    </div>
  );
}
