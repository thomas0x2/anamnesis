// The course map: every NumCS concept with its prerequisites, coloured by where you stand.
import { Graph, layout } from "@dagrejs/dagre";
import { cardRetrievability } from "@shared/fsrs";
import { masteryMean, statusRank } from "@shared/mastery";
import type { ConceptStatus, CourseConcept } from "@shared/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { DemoModal } from "../components/Modal";
import { DEMOS } from "../demos";
import { useApp } from "../engine/app";
import { useStore } from "../engine/store";
import { pct, relTime, STATUS_HELP, STATUS_LABEL } from "../lib/format";
import { useNow } from "../lib/hooks";
import { StatusLegend } from "./CourseView";

const W = 196;
const H = 46;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const clampZoom = (z: number): number =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

interface LaidNode {
  id: string;
  x: number;
  y: number;
  ghost: boolean;
}

interface LaidMap {
  nodes: LaidNode[];
  edges: { from: string; to: string; d: string }[];
  width: number;
  height: number;
}

/** Smooth path through dagre's control points (Catmull-Rom as cubic Béziers). */
function smooth(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  let d = `M${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
}

function layOut(
  concepts: CourseConcept[],
  all: Map<string, CourseConcept>,
): LaidMap {
  const ids = new Set(concepts.map((c) => c.id));
  const ghosts = new Set<string>();
  for (const c of concepts)
    for (const r of c.requires) if (!ids.has(r) && all.has(r)) ghosts.add(r);
  const g = new Graph();
  g.setGraph({
    rankdir: "LR",
    nodesep: 14,
    ranksep: 56,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const id of [...ghosts, ...ids]) g.setNode(id, { width: W, height: H });
  for (const c of concepts)
    for (const r of c.requires)
      if (ids.has(r) || ghosts.has(r)) g.setEdge(r, c.id);
  layout(g);
  const info = g.graph() as { width?: number; height?: number };
  return {
    nodes: [...ghosts, ...ids].map((id) => {
      const v = g.node(id) as { x: number; y: number };
      return { id, x: v.x, y: v.y, ghost: ghosts.has(id) };
    }),
    edges: g
      .edges()
      .map((e: { v: string; w: string }) => ({
        from: e.v,
        to: e.w,
        d: smooth(
          (
            (g.edge(e) as { points?: { x: number; y: number }[] }).points ?? []
          ).slice(),
        ),
      })),
    width: info.width ?? 400,
    height: info.height ?? 300,
  };
}

export function MapView({ conceptId }: { conceptId?: string }): ReactElement {
  const app = useApp();
  const graph = app.graph;
  const learner = useStore(app.state, (s) => s.learner);
  const chapters = useMemo(
    () =>
      [...app.course.chapters].sort(
        (a, b) => (a.number || 99) - (b.number || 99),
      ),
    [app],
  );
  const frontier = useMemo(
    () => new Set(graph.frontier(learner)),
    [graph, learner],
  );
  const initialChapter = (): number | "all" => {
    if (conceptId && graph.get(conceptId)) return graph.get(conceptId)!.chapter;
    const f = app.nextConcepts(learner)[0];
    return f ? graph.get(f)!.chapter || 1 : 1;
  };
  const [chapter, setChapter] = useState<number | "all">(initialChapter);
  const [selected, setSelected] = useState<string | null>(conceptId ?? null);

  useEffect(() => {
    if (conceptId && graph.get(conceptId)) {
      setSelected(conceptId);
      setChapter(graph.get(conceptId)!.chapter);
    }
  }, [conceptId, graph]);

  const concepts = useMemo(
    () =>
      chapter === "all"
        ? app.course.concepts
        : app.course.concepts.filter((c) => c.chapter === chapter),
    [app, chapter],
  );
  const laid = useMemo(() => layOut(concepts, graph.byId), [concepts, graph]);
  const statusOf = (id: string): ConceptStatus =>
    learner.concepts[id]?.status ?? "unseen";
  const linked = useMemo(() => {
    if (!selected) return new Set<string>();
    const c = graph.get(selected);
    return new Set([
      selected,
      ...(c?.requires ?? []),
      ...(graph.children.get(selected) ?? []),
    ]);
  }, [selected, graph]);

  // Zoom and pan. Ctrl/Cmd + wheel (and trackpad pinch) zooms around the pointer; dragging the background pans.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const zoomRef = useRef(1);
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const setZoom = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const el = canvasRef.current;
      const z0 = zoomRef.current;
      const z1 = clampZoom(next);
      if (!el || z1 === z0) return;
      const ax = anchor?.x ?? el.clientWidth / 2;
      const ay = anchor?.y ?? el.clientHeight / 2;
      pendingScroll.current = {
        left: ((el.scrollLeft + ax) * z1) / z0 - ax,
        top: ((el.scrollTop + ay) * z1) / z0 - ay,
      };
      zoomRef.current = z1;
      setZoomState(z1);
    },
    [],
  );
  const fitZoom = useCallback((): number => {
    const el = canvasRef.current;
    if (!el) return 1;
    return clampZoom(
      Math.min(
        1,
        (el.clientWidth - 8) / laid.width,
        (el.clientHeight - 8) / laid.height,
      ),
    );
  }, [laid]);
  const fit = useCallback(() => {
    const z = fitZoom();
    pendingScroll.current = { left: 0, top: 0 };
    zoomRef.current = z;
    setZoomState(z);
  }, [fitZoom]);
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (el && pendingScroll.current) {
      el.scrollLeft = pendingScroll.current.left;
      el.scrollTop = pendingScroll.current.top;
      pendingScroll.current = null;
    }
  }, [zoom]);
  // A new chapter starts at full size, or zoomed out just enough to fit when it is bigger than the view.
  useLayoutEffect(() => {
    fit();
  }, [fit]);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0025), {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    id: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = canvasRef.current!;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      id: e.pointerId,
    };
    el.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const el = canvasRef.current!;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = (): void => {
    drag.current = null;
    setPanning(false);
  };

  const counts = useMemo(() => {
    const out: Record<ConceptStatus, number> = {
      unseen: 0,
      introduced: 0,
      developing: 0,
      proficient: 0,
      mastered: 0,
    };
    for (const c of concepts) out[statusOf(c.id)]++;
    return out;
  }, [concepts, learner]);

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <div className="page-head">
        <div>
          <h1>Course map</h1>
          <div className="sub">
            {app.course.concepts.length} concepts and what each one needs.
            Arrows point from a prerequisite to what builds on it.
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <div className="tabs" role="tablist" aria-label="Chapter">
          {chapters.map((ch) => (
            <button
              key={ch.number}
              className={chapter === ch.number ? "active" : ""}
              onClick={() => setChapter(ch.number)}
              title={ch.title}
              role="tab"
              aria-selected={chapter === ch.number}
            >
              {ch.number ? `Ch ${ch.number}` : "Refreshers"}
            </button>
          ))}
          <button
            className={chapter === "all" ? "active" : ""}
            onClick={() => setChapter("all")}
            role="tab"
            aria-selected={chapter === "all"}
          >
            All
          </button>
        </div>
        <span className="small muted">
          {chapter === "all"
            ? "Whole course"
            : chapters.find((c) => c.number === chapter)?.title}{" "}
          ·{" "}
          {(
            [
              "mastered",
              "proficient",
              "developing",
              "introduced",
            ] as ConceptStatus[]
          )
            .filter((s) => counts[s])
            .map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`)
            .join(", ") || "not started"}
        </span>
      </div>

      <div className="map-layout">
        <div className="map-wrap">
          <div
            className={`map-canvas ${panning ? "panning" : ""}`}
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div
              style={{ width: laid.width * zoom, height: laid.height * zoom }}
            >
              <div
                style={{
                  position: "relative",
                  width: laid.width,
                  height: laid.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "0 0",
                }}
              >
                <svg
                  width={laid.width}
                  height={laid.height}
                  style={{ position: "absolute", inset: 0 }}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id="map-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#5a5a5a" />
                    </marker>
                    <marker
                      id="map-arrow-hl"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill="#6a6a6a" />
                    </marker>
                  </defs>
                  {laid.edges.map((e) => {
                    const hl =
                      !!selected && (e.from === selected || e.to === selected);
                    return (
                      <path
                        key={`${e.from}>${e.to}`}
                        d={e.d}
                        className={`map-edge ${hl ? "hl" : ""}`}
                        markerEnd={`url(#${hl ? "map-arrow-hl" : "map-arrow"})`}
                      />
                    );
                  })}
                </svg>
                {laid.nodes.map((n) => {
                  const c = graph.get(n.id)!;
                  const st = statusOf(n.id);
                  const dim = !!selected && !linked.has(n.id);
                  return (
                    <button
                      key={n.id}
                      className={`map-node ${selected === n.id ? "selected" : ""} ${n.ghost ? "ghost" : ""} ${c.tier === "extra" ? "extra" : ""} ${frontier.has(n.id) && !n.ghost ? "frontier" : ""}`}
                      style={{
                        position: "absolute",
                        left: n.x - W / 2,
                        top: n.y - H / 2,
                        width: W,
                        height: H,
                        opacity: dim ? 0.45 : undefined,
                      }}
                      onClick={() =>
                        setSelected(n.id === selected ? null : n.id)
                      }
                      title={`${c.title} · ${STATUS_LABEL[st]}${n.ghost ? ` · from chapter ${c.chapter || "refreshers"}` : ""}`}
                    >
                      <span className={`status-dot ${st}`} />
                      <span className="t">
                        <Markdown text={c.title} inline />
                      </span>
                      {frontier.has(n.id) && !n.ghost && (
                        <Icon
                          name="target"
                          size={13}
                          style={{ color: "var(--accent-text)", flex: "none" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="map-zoom" role="group" aria-label="Zoom">
            <button
              className="btn sm ghost"
              onClick={() => setZoom(zoomRef.current / 1.25)}
              disabled={zoom <= MIN_ZOOM}
              title="Zoom out (Ctrl or Cmd + scroll)"
              aria-label="Zoom out"
            >
              <Icon name="minus" size={14} />
            </button>
            <button
              className="btn sm ghost zoom-pct"
              onClick={() => setZoom(1)}
              title="Back to 100%"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              className="btn sm ghost"
              onClick={() => setZoom(zoomRef.current * 1.25)}
              disabled={zoom >= MAX_ZOOM}
              title="Zoom in (Ctrl or Cmd + scroll)"
              aria-label="Zoom in"
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              className="btn sm ghost"
              onClick={fit}
              title="Fit the whole map in view"
            >
              Fit
            </button>
          </div>
        </div>

        <div className="concept-panel">
          {selected && graph.get(selected) ? (
            <ConceptPanel
              id={selected}
              onSelect={(id) => setSelected(id)}
              ready={frontier.has(selected)}
            />
          ) : (
            <div className="panel stack">
              <h3>Pick a concept</h3>
              <p className="small muted" style={{ margin: 0 }}>
                Click any box to see what it means, what it needs, and to start
                learning or practising it. Boxes with a{" "}
                <Icon
                  name="target"
                  size={12}
                  style={{ color: "var(--accent-text)", verticalAlign: "-2px" }}
                />{" "}
                are ready: their prerequisites are in place. Dashed boxes come
                from another chapter.
              </p>
              <StatusLegend />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConceptPanel({
  id,
  onSelect,
  ready,
}: {
  id: string;
  onSelect: (id: string) => void;
  ready: boolean;
}): ReactElement {
  const app = useApp();
  const graph = app.graph;
  const c = graph.get(id)!;
  const cs = useStore(app.state, (s) => s.learner.concepts[id]);
  const status = useStore(app.script.status, (s) => s.state);
  const now = useNow();
  const [demo, setDemo] = useState<string | null>(null);
  const st = cs?.status ?? "unseen";
  const mastery = cs && st !== "unseen" ? masteryMean(cs) : null;
  const memory = cs ? cardRetrievability(cs.fsrs, now) : null;
  const unmet = c.requires.filter(
    (r) =>
      statusRank(app.state.get().learner.concepts[r]?.status ?? "unseen") < 2,
  );
  const leadsTo = graph.children.get(id) ?? [];
  const offset = app.course.script.printedPageOffset;
  const demos = c.demos.filter((d) => DEMOS[d]);

  return (
    <div className="panel stack">
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="chip outline">
            {c.chapter ? `Chapter ${c.chapter}` : "Refresher"}
          </span>
          <span className="chip">
            <span className={`status-dot ${st}`} /> {STATUS_LABEL[st]}
          </span>
          {ready && <span className="chip accent">ready</span>}
          {c.addedAt && Date.now() - Date.parse(c.addedAt) < 7 * 86_400_000 && <span className="chip">new this week</span>}
        </div>
        <h2>
          <Markdown text={c.title} inline />
        </h2>
        {c.de && <div className="de">{c.de}</div>}
      </div>
      <div className="small">
        <Markdown text={c.summary} />
      </div>
      <div className="small" style={{ color: "var(--text-2)" }}>
        <b style={{ color: "var(--text)" }}>Why it matters. </b>
        <Markdown text={c.why} inline />
      </div>

      <div className="kv">
        <span className="k">Where you stand</span>
        <span>{STATUS_HELP[st]}</span>
        {mastery !== null && (
          <>
            <span className="k">Mastery</span>
            <span className="row" style={{ gap: 8 }}>
              <span className="bar" style={{ flex: 1 }}>
                <span style={{ width: pct(mastery) }} />
              </span>
              {pct(mastery)}
            </span>
          </>
        )}
        {memory !== null && (
          <>
            <span className="k">Memory now</span>
            <span>
              {pct(memory)}
              {cs?.fsrs?.due
                ? `, next review ${relTime(cs.fsrs.due, now)}`
                : ""}
            </span>
          </>
        )}
        {c.pages.length >= 2 && (
          <>
            <span className="k">{app.course.builtin ? "Script" : "Pages"}</span>
            <span className="row" style={{ gap: 6 }}>
              {app.course.builtin
                ? `pages ${c.pages[0] + offset}–${c.pages[1] + offset}`
                : app.script.label(c.pages[0])}
              {status === "ready" && (
                <button
                  className="btn sm ghost"
                  style={{ height: 22, padding: "0 6px" }}
                  onClick={() =>
                    app.peekScript(c.pages[0], c.refs[0] ?? c.title)
                  }
                >
                  <Icon name="eye" size={14} /> open
                </button>
              )}
            </span>
          </>
        )}
        {(c.sources ?? []).length > 0 && (
          <>
            <span className="k">Also in</span>
            <span className="stack" style={{ gap: 2 }}>
              {(c.sources ?? []).slice(0, 6).map((src, i) => (
                <PageLink key={i} label={src.label} page={src.pages[0]} ready={status === "ready"} />
              ))}
            </span>
          </>
        )}
        {(c.exercises ?? []).length > 0 && (
          <>
            <span className="k">Practised in</span>
            <span className="stack" style={{ gap: 2 }}>
              {(c.exercises ?? []).slice(0, 8).map((src, i) => (
                <PageLink key={i} label={src.label} page={src.pages[0]} ready={status === "ready"} />
              ))}
            </span>
          </>
        )}
        {c.refs.length > 0 && (
          <>
            <span className="k">In the script</span>
            <span className="small">{c.refs.slice(0, 6).join(", ")}</span>
          </>
        )}
      </div>

      {c.requires.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Needs{" "}
            {unmet.length
              ? `(${unmet.length} not solid yet: the probe will check them)`
              : ""}
          </div>
          <div className="req-list">
            {c.requires.map((r) => (
              <button key={r} className="req" onClick={() => onSelect(r)}>
                <span
                  className={`status-dot ${app.state.get().learner.concepts[r]?.status ?? "unseen"}`}
                />
                <Markdown text={graph.title(r)} inline />
              </button>
            ))}
          </div>
        </div>
      )}
      {leadsTo.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Leads to
          </div>
          <div className="req-list">
            {leadsTo.map((r) => (
              <button key={r} className="req" onClick={() => onSelect(r)}>
                <span
                  className={`status-dot ${app.state.get().learner.concepts[r]?.status ?? "unseen"}`}
                />
                <Markdown text={graph.title(r)} inline />
              </button>
            ))}
          </div>
        </div>
      )}

      {demos.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Interactive demos
          </div>
          <div className="req-list">
            {demos.map((d) => (
              <button key={d} className="req" onClick={() => setDemo(d)}>
                <Icon
                  name="zap"
                  size={13}
                  style={{ color: "var(--accent-text)" }}
                />{" "}
                {DEMOS[d].title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row wrap" style={{ marginTop: 4 }}>
        <button className="btn primary" onClick={() => void app.startLearn(id)}>
          <Icon name="probe" size={16} />{" "}
          {st === "unseen" ? "Learn this" : "Learn again"}
        </button>
        <button
          className="btn"
          disabled={st === "unseen"}
          onClick={() => void app.startPractice([id])}
          title={
            st === "unseen"
              ? "Learn it first"
              : "Practice items on this concept"
          }
        >
          <Icon name="dumbbell" size={16} /> Practice
        </button>
        <button
          className="btn ghost"
          onClick={() => app.go({ name: "mind", conceptId: id })}
        >
          <Icon name="mind" size={16} /> Mind model
        </button>
      </div>
      {demo && <DemoModal id={demo} onClose={() => setDemo(null)} />}
    </div>
  );
}

function PageLink({ label, page, ready }: { label: string; page: number; ready: boolean }): ReactElement {
  const app = useApp();
  return (
    <span className="row small" style={{ gap: 6 }}>
      <span>{label}</span>
      {ready && (
        <button className="btn sm ghost" style={{ height: 22, padding: "0 6px" }} onClick={() => app.peekScript(page, label)} title={app.script.label(page)}>
          <Icon name="eye" size={14} /> open
        </button>
      )}
    </span>
  );
}
