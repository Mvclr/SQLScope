'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';

export interface ForeignKeyEdgeData extends Record<string, unknown> {
  /** 1:1 when the foreign key columns are also unique; 1:N otherwise. */
  oneToOne: boolean;
  born: boolean;
  stamp: number;
  label: string;
}

export type ForeignKeyEdgeType = Edge<ForeignKeyEdgeData, 'foreignKey'>;

const cardinality =
  'pointer-events-none absolute rounded-md border border-border bg-surface-1 px-1 font-mono text-[10px] leading-4 text-structure';

/** Referenced (parent) column on the left, referencing (child) column on the right. */
export function ForeignKeyEdge(props: EdgeProps<ForeignKeyEdgeType>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected } =
    props;
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <>
      <BaseEdge
        key={data?.born ? data.stamp : 'steady'}
        id={props.id}
        path={path}
        className={data?.born ? 'edge-born' : ''}
        style={{ strokeWidth: selected ? 2 : 1.5 }}
      />
      <EdgeLabelRenderer>
        <span
          className={cardinality}
          style={{ transform: `translate(${sourceX + 6}px, ${sourceY - 21}px)` }}
        >
          1
        </span>
        <span
          className={cardinality}
          style={{ transform: `translate(${targetX - 18}px, ${targetY - 21}px)` }}
          title={data?.label}
        >
          {data?.oneToOne ? '1' : 'N'}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
