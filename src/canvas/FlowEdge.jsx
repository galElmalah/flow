import React, { useEffect, useState } from "react";
import { BaseEdge, getBezierPath } from "@xyflow/react";

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function FlowEdge(props) {
  const [edgePath] = getBezierPath({ ...props, curvature: 0.5 });
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const isText = props.sourceHandleId === "text";
  const emphasized = props.selected || hovered;
  const color = emphasized ? "#ffffff" : "#bcbcbc";
  return (
    <g
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <path
        d={edgePath}
        stroke={color}
        strokeWidth="7"
        opacity=".035"
        fill="none"
      />
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: emphasized ? 2.2 : 1.25,
          opacity: emphasized ? 1 : 0.7,
        }}
        interactionWidth={20}
      />
      {!reducedMotion && (
        <circle r="2.6" fill={color} opacity=".95" pointerEvents="none">
          <animateMotion
            dur={isText ? "7s" : "9s"}
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      )}
    </g>
  );
}
export const edgeTypes = { flow: FlowEdge };
