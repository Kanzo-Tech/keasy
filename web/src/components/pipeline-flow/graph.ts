import type { Node, Edge } from "@xyflow/react";
import type { PipelineSummary, Field } from "@/lib/types";
import type { FieldNodeData, KeyPair } from "./types";

export function computeUsedFields(edges: Edge[]): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  for (const edge of edges) {
    for (const [nodeId, handle] of [
      [edge.source, edge.sourceHandle],
      [edge.target, edge.targetHandle],
    ] as const) {
      if (!handle?.startsWith("field-") && !handle?.startsWith("dual-field-"))
        continue;
      const fieldName = handle.startsWith("dual-field-")
        ? handle.slice(11)
        : handle.slice(6);
      if (!used.has(nodeId)) used.set(nodeId, new Set());
      used.get(nodeId)!.add(fieldName);
    }
  }
  return used;
}

export function buildPipelineGraph(pipeline: PipelineSummary): {
  nodes: Node[];
  edges: Edge[];
} {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const inputIds = new Map<string, string>();

  for (const input of pipeline.inputs) {
    const id = `input-${input.name}`;
    inputIds.set(input.name, id);
    nodes.push({
      id,
      type: "field",
      position: { x: 0, y: 0 },
      data: {
        label: input.name,
        fields: input.fields,
        handleSide: "right",
      } satisfies FieldNodeData,
    });
  }

  for (let i = 0; i < pipeline.operations.length; i++) {
    const op = pipeline.operations[i];

    let keyPairs: KeyPair[] | undefined;
    if (op.inputs.length >= 2) {
      keyPairs = op.inputs[0].key_fields.map((left, j) => ({
        left,
        right: op.inputs[1].key_fields[j],
      }));
    }

    nodes.push({
      id: `op-${i}`,
      type: "field",
      position: { x: 0, y: 0 },
      data: {
        label: op.label,
        fields: op.fields,
        handleSide: "right",
        variant: "operation",
        dualHandleKeys: op.inputs.flatMap((inp) => inp.key_fields),
        keyPairs,
      } satisfies FieldNodeData,
    });
  }

  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    nodes.push({
      id: `out-${i}-${out.type_name}`,
      type: "field",
      position: { x: 0, y: 0 },
      data: {
        label: out.type_name,
        fields: out.fields,
        handleSide: "left",
      } satisfies FieldNodeData,
    });
  }

  const destMap = new Map<string, string[]>();
  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    if (out.destination) {
      const outId = `out-${i}-${out.type_name}`;
      const list = destMap.get(out.destination) ?? [];
      list.push(outId);
      destMap.set(out.destination, list);
    }
  }

  let destIdx = 0;
  for (const [url, outIds] of destMap) {
    const destId = `dest-${destIdx++}`;
    nodes.push({
      id: destId,
      type: "destination",
      position: { x: 0, y: 0 },
      data: { url },
    });
    for (const outId of outIds) {
      edges.push({
        id: `e-${outId}-${destId}`,
        source: outId,
        sourceHandle: "dest",
        target: destId,
        targetHandle: "target",
        animated: true,
      });
    }
  }

  // Build right-key → left-key remap per operation (for unified pair handles)
  const pairRemap = new Map<string, Map<string, string>>();
  for (let i = 0; i < pipeline.operations.length; i++) {
    const op = pipeline.operations[i];
    if (op.inputs.length >= 2) {
      const remap = new Map<string, string>();
      for (let j = 0; j < op.inputs[0].key_fields.length; j++) {
        remap.set(op.inputs[1].key_fields[j], op.inputs[0].key_fields[j]);
      }
      pairRemap.set(`op-${i}`, remap);
    }
  }

  const prevOpInChain = new Map<string, string>();
  for (let i = 0; i < pipeline.operations.length; i++) {
    const op = pipeline.operations[i];
    const opId = `op-${i}`;
    const remap = pairRemap.get(opId);
    for (const input of op.inputs) {
      const sourceNodeId =
        prevOpInChain.get(input.source) ?? inputIds.get(input.source);
      if (!sourceNodeId) continue;
      for (const field of input.key_fields) {
        const targetField = remap?.get(field) ?? field;
        edges.push({
          id: `e-${sourceNodeId}-${field}-${opId}`,
          source: sourceNodeId,
          sourceHandle: `field-${field}`,
          target: opId,
          targetHandle: `field-${targetField}`,
          animated: true,
        });
      }
    }
    if (op.inputs.length > 0) prevOpInChain.set(op.inputs[0].source, opId);
  }

  function resolveSourceNode(
    source: string,
  ): { nodeId: string; fields: Field[] } | null {
    let lastOp: { nodeId: string; fields: Field[] } | null = null;
    for (let i = 0; i < pipeline.operations.length; i++) {
      const op = pipeline.operations[i];
      if (op.inputs.some((inp) => inp.source === source))
        lastOp = { nodeId: `op-${i}`, fields: op.fields };
    }
    if (lastOp) return lastOp;
    const srcId = inputIds.get(source);
    if (srcId) {
      const srcInput = pipeline.inputs.find((inp) => inp.name === source);
      if (srcInput) return { nodeId: srcId, fields: srcInput.fields };
    }
    return null;
  }

  for (let i = 0; i < pipeline.outputs.length; i++) {
    const out = pipeline.outputs[i];
    const outId = `out-${i}-${out.type_name}`;
    if (!out.source) continue;
    const resolved = resolveSourceNode(out.source);
    if (!resolved) continue;
    const { nodeId: sourceNodeId, fields: sourceFields } = resolved;
    const srcFieldSet = new Set(sourceFields.map((f) => f.name));
    const outFieldSet = new Set(out.fields.map((f) => f.name));
    const remap = pairRemap.get(sourceNodeId);
    for (const m of out.mappings ?? []) {
      const srcField = srcFieldSet.has(m.source) ? m.source : null;
      if (srcField && outFieldSet.has(m.target)) {
        const mappedSrc = remap?.get(srcField) ?? srcField;
        edges.push({
          id: `ef-${sourceNodeId}-${srcField}-${outId}-${m.target}`,
          source: sourceNodeId,
          sourceHandle: `field-${mappedSrc}`,
          target: outId,
          targetHandle: `field-${m.target}`,
          animated: true,
        });
      }
    }
  }

  const usedFieldsMap = computeUsedFields(edges);
  for (const node of nodes) {
    if (node.type === "field")
      (node.data as FieldNodeData).usedFields = usedFieldsMap.get(node.id);
  }

  return { nodes, edges };
}
