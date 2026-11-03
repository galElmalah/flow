import React, { memo, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";

const animation = {
  animation: "blurIn",
  duration: 180,
  stagger: 12,
  maxBacklogMs: 180,
  easing: "ease-out",
  sep: "word",
};
const components = {
  img: ({ alt }) => (
    <span className="agent-image-reference">{alt || "Image reference"}</span>
  ),
};
export const AgentMessage = memo(function AgentMessage({
  text = "",
  live = false,
  onResize,
}) {
  const [tail, setTail] = useState(live);
  const node = useRef(null);
  useEffect(() => {
    if (live) {
      setTail(true);
      return;
    }
    const timer = setTimeout(() => setTail(false), 380);
    return () => clearTimeout(timer);
  }, [live, text]);
  useEffect(() => {
    if (!node.current || !onResize) return;
    const observer = new ResizeObserver(onResize);
    observer.observe(node.current);
    return () => observer.disconnect();
  }, [onResize]);
  return (
    <div className="agent-markdown" ref={node} aria-busy={live}>
      <Streamdown
        animated={animation}
        isAnimating={live || tail}
        mode={live || tail ? "streaming" : "static"}
        caret={live ? "block" : undefined}
        controls={false}
        skipHtml
        components={components}
      >
        {text}
      </Streamdown>
    </div>
  );
});
