import type { Field } from "@/lib/types";

export interface KeyPair {
  left: string;
  right: string;
}

export type FieldNodeData = {
  label: string;
  fields: Field[];
  handleSide: "left" | "right";
  variant?: "operation";
  dualHandleKeys?: string[];
  usedFields?: Set<string>;
  keyPairs?: KeyPair[];
};

export const SCHEMA_NODE_WIDTH = 240;
export const HEADER_HEIGHT = 36;
export const ROW_HEIGHT = 28;
export const DEST_NODE_WIDTH = 280;
export const DEST_NODE_HEIGHT = 40;
