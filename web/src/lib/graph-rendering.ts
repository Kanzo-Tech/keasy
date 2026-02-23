/** Resolve --primary CSS variable for canvas use */
export function getAccentColor(): string {
  if (typeof document === "undefined") return "oklch(0.488 0.243 264.376)";
  return getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "oklch(0.488 0.243 264.376)";
}

/** Resolve --foreground CSS variable for canvas text */
export function getForegroundColor(): string {
  if (typeof document === "undefined") return "oklch(0.985 0 0)";
  return getComputedStyle(document.documentElement).getPropertyValue("--foreground").trim() || "oklch(0.985 0 0)";
}

/** Resolve --font-sans CSS variable for canvas font strings */
export function getFontFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  return getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
}

const LITERAL_COLOR = "#64748b";


export interface GraphSizeScale {
  nodeRadius: number;
  fontSize: number;
  literalRadius: number;
  literalFontSize: number;
  literalMaxWidth: number;
}

const SCALE_MAP: Record<string, GraphSizeScale> = {
  compact: { nodeRadius: 8, fontSize: 12, literalRadius: 5, literalFontSize: 10, literalMaxWidth: 100 },
  default: { nodeRadius: 10, fontSize: 14, literalRadius: 6, literalFontSize: 11, literalMaxWidth: 120 },
  comfortable: { nodeRadius: 13, fontSize: 16, literalRadius: 7, literalFontSize: 12, literalMaxWidth: 140 },
};

export function getGraphScale(fontSizePref: string): GraphSizeScale {
  return SCALE_MAP[fontSizePref] ?? SCALE_MAP.default;
}


export function getNodeRadius(group: string, globalScale: number, scale?: GraphSizeScale): number {
  const s = scale ?? SCALE_MAP.default;
  return (group === "literal" ? s.literalRadius : s.nodeRadius) / globalScale;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLiteralBox(node: any, ctx: CanvasRenderingContext2D, globalScale: number, scale?: GraphSizeScale) {
  const s = scale ?? SCALE_MAP.default;
  const label = node.label ?? node.id ?? "";
  const padding = 4 / globalScale;
  const litFontSize = s.literalFontSize / globalScale;
  ctx.font = `${litFontSize}px ${getFontFamily()}`;
  const textWidth = ctx.measureText(label).width;
  const maxBoxW = s.literalMaxWidth / globalScale;
  const boxW = Math.min(textWidth + padding * 2, maxBoxW);
  const boxH = litFontSize + padding * 2;
  const cornerR = 3 / globalScale;
  return { boxW, boxH, cornerR };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


export function drawNode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  selectedId?: string,
  scale?: GraphSizeScale,
): void {
  const s = scale ?? SCALE_MAP.default;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const radius = getNodeRadius(node.group, globalScale, s);

  if (node.group === "literal") {
    const label = node.label ?? node.id ?? "";
    const { boxW, boxH, cornerR } = getLiteralBox(node, ctx, globalScale, s);
    const padding = 4 / globalScale;
    const litFontSize = s.literalFontSize / globalScale;

    ctx.beginPath();
    ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, cornerR);
    ctx.fillStyle = LITERAL_COLOR;
    ctx.globalAlpha = 0.15;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.strokeStyle = LITERAL_COLOR;
    ctx.lineWidth = 1 / globalScale;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (selectedId && selectedId === node.id) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = getForegroundColor();
    const textWidth = ctx.measureText(label).width;
    const displayLabel = textWidth > boxW - padding * 2
      ? label.slice(0, Math.floor((boxW - padding * 2) / (litFontSize * 0.6))) + "..."
      : label;
    ctx.fillText(displayLabel, x, y);
  } else {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = getAccentColor();
    ctx.fill();

    if (selectedId && selectedId === node.id) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2 / globalScale;
      ctx.stroke();
    }
  }
}


export function drawLink(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  link: any,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  scale?: GraphSizeScale,
): void {
  const source = typeof link.source === "object" ? link.source : null;
  const target = typeof link.target === "object" ? link.target : null;
  if (!source || !target) return;

  const s = scale ?? SCALE_MAP.default;
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  const fg = getForegroundColor();

  if (source.id === target.id) {
    const loopRadius = (s.nodeRadius * 2) / globalScale;
    const nodeR = getNodeRadius(source.group ?? "resource", globalScale, s);
    const cx = sx;
    const cy = sy - nodeR - loopRadius;

    ctx.beginPath();
    ctx.arc(cx, cy, loopRadius, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 1 / globalScale;
    ctx.stroke();

    const arrowLen = 5 / globalScale;
    const ax = cx + loopRadius;
    const ay = cy;
    const arrowAngle = Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - arrowLen * Math.cos(arrowAngle - Math.PI / 7),
      ay - arrowLen * Math.sin(arrowAngle - Math.PI / 7),
    );
    ctx.lineTo(
      ax - arrowLen * Math.cos(arrowAngle + Math.PI / 7),
      ay - arrowLen * Math.sin(arrowAngle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
    ctx.fill();

    if (link.label && globalScale >= 1.5) {
      const fontSize = s.literalFontSize / globalScale;
      ctx.font = `${fontSize}px ${getFontFamily()}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.6;
      ctx.fillText(link.label, cx, cy - loopRadius - 2 / globalScale);
      ctx.globalAlpha = 1;
    }

    return;
  }

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
  ctx.lineWidth = 1 / globalScale;
  ctx.stroke();

  const angle = Math.atan2(ty - sy, tx - sx);
  const arrowLen = 5 / globalScale;
  const nodeRadius = getNodeRadius(target.group ?? "resource", globalScale, s);
  const ax = tx - Math.cos(angle) * (nodeRadius + 1 / globalScale);
  const ay = ty - Math.sin(angle) * (nodeRadius + 1 / globalScale);

  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(
    ax - arrowLen * Math.cos(angle - Math.PI / 7),
    ay - arrowLen * Math.sin(angle - Math.PI / 7),
  );
  ctx.lineTo(
    ax - arrowLen * Math.cos(angle + Math.PI / 7),
    ay - arrowLen * Math.sin(angle + Math.PI / 7),
  );
  ctx.closePath();
  ctx.fillStyle = "rgba(148, 163, 184, 0.5)";
  ctx.fill();

  if (link.label && globalScale >= 1.5) {
    const mx = (sx + tx) / 2;
    const my = (sy + ty) / 2;
    const fontSize = s.literalFontSize / globalScale;
    ctx.font = `${fontSize}px ${getFontFamily()}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = fg;
    ctx.globalAlpha = 0.6;
    ctx.fillText(link.label, mx, my);
    ctx.globalAlpha = 1;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildNodeTooltip(node: any): string {
  const props: Record<string, string> = node.properties ?? {};
  const entries = Object.entries(props);
  const propsHtml = entries
    .map(
      ([k, v]) =>
        `<div style="margin-top:3px;line-height:1.3"><span style="opacity:0.5">${k}:</span> ${escapeHtml(v)}</div>`,
    )
    .join("");
  return `<div style="padding:6px 10px;font-size:0.6875rem;max-width:340px;font-family:var(--font-mono)">
    <div style="font-weight:600;margin-bottom:1px">${escapeHtml(node.label)}</div>
    <div style="opacity:0.5;font-size:0.625rem;margin-bottom:2px">${node.group}</div>
    ${propsHtml}
  </div>`;
}
