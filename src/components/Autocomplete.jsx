import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Search,
} from "lucide-react";
import {
  filterOptions,
  nextEnabled,
  popupPosition,
  findChoice,
  childChoices,
} from "./autocomplete-options.mjs";
import "../autocomplete.css";

/** Controlled choice with searchable labels; unrecognized saved values stay visible. */
export function Autocomplete({
  label,
  value,
  options,
  onChange,
  disabled = false,
  id,
  className = "",
  popupMinWidth = 180,
  fallbackLabel,
  popupClassName = "",
  searchPlaceholder,
  submenuMode = "columns",
  renderHeader,
  groupLabel = "Harnesses",
}) {
  const generatedId = useId();
  const inputId = id || `autocomplete-${generatedId}`;
  const listId = `${inputId}-options`;
  const anchor = useRef(null),
    popup = useRef(null),
    input = useRef(null);
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [active, setActive] = useState(-1),
    [position, setPosition] = useState(null),
    [branch, setBranch] = useState(null),
    [childActive, setChildActive] = useState(-1);
  const drilldown = submenuMode === "drilldown";
  const nested = options.some((option) => option.children?.length);
  const selected = findChoice(options, value);
  const selectedLabel =
    selected?.selectedLabel ??
    selected?.label ??
    fallbackLabel ??
    String(value ?? "");
  const visible = filterOptions(options, query);
  const parent = (drilldown ? options : visible).find(
    (option) => option.value === branch && !option.disabled,
  );
  const children = childChoices(parent, query);
  const inSubmenu = drilldown ? Boolean(parent) : childActive >= 0;
  const childListId = `${listId}-models`;
  const navigationKey = visible
    .map((option) => `${option.value}:${Boolean(option.disabled)}`)
    .join("\n");
  const close = () => {
    setOpen(false);
    setQuery("");
    setBranch(null);
    setChildActive(-1);
  };
  const show = () => {
    if (disabled || open) return;
    setQuery("");
    setActive(-1);
    setOpen(true);
  };
  const back = () => {
    setBranch(null);
    setChildActive(-1);
    setQuery("");
    input.current?.focus();
  };
  const choose = (option) => {
    if (!option || option.disabled || disabled) return;
    if (option.children?.length) {
      setBranch(option.value);
      setChildActive(nextEnabled(childChoices(option, query), -1, 1));
      return;
    }
    close();
    onChange(String(option.value));
  };

  useEffect(() => {
    if (!open) return;
    const selectedIndex = visible.findIndex(
      (option) =>
        (String(option.value) === String(value) ||
          option.children?.some(
            (child) => String(child.value) === String(value),
          )) &&
        !option.disabled,
    );
    setActive(
      !query.trim() && selectedIndex >= 0
        ? selectedIndex
        : nextEnabled(visible, -1, 1),
    );
    if (nested && drilldown) {
      setChildActive(branch ? nextEnabled(children, -1, 1) : -1);
    } else if (nested) {
      const index =
        !query.trim() && selectedIndex >= 0
          ? selectedIndex
          : nextEnabled(visible, -1, 1);
      setBranch(visible[index]?.value ?? null);
      setChildActive(-1);
    }
  }, [open, query, navigationKey, value]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    let frame;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (
        !rect ||
        !anchor.current.isConnected ||
        anchor.current.closest("[inert]") ||
        !anchor.current.getClientRects().length ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        getComputedStyle(anchor.current).visibility === "hidden" ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        setOpen(false);
        return;
      }
      let desiredHeight =
        popup.current?.scrollHeight || Math.max(44, visible.length * 36 + 10);
      if (drilldown) {
        const body = popup.current?.querySelector(
          branch ? ".autocomplete-models" : ".autocomplete-branches",
        );
        const header = popup.current?.querySelector(
          ".autocomplete-popup-header",
        );
        desiredHeight = body
          ? [...body.children].reduce(
              (height, child) => height + child.getBoundingClientRect().height,
              10,
            ) +
            (header?.scrollHeight || 0) +
            2
          : visible.length * 42 + 90;
      }
      const next = popupPosition(
        rect,
        { width: window.innerWidth, height: window.innerHeight },
        desiredHeight,
        nested && !drilldown ? Math.max(580, popupMinWidth) : popupMinWidth,
      );
      if (drilldown) next.height = Math.min(next.maxHeight, desiredHeight);
      setPosition((previous) =>
        previous &&
        Object.keys(next).every((key) => previous[key] === next[key])
          ? previous
          : next,
      );
      frame = requestAnimationFrame(place);
    };
    place();
    const outside = (event) => {
      if (
        !anchor.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [
    open,
    visible.length,
    popupMinWidth,
    nested,
    drilldown,
    branch,
    children.length,
  ]);
  useEffect(() => {
    if (open && active >= 0)
      popup.current
        ?.querySelector(`[data-option-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  useEffect(() => {
    if (open && childActive >= 0)
      popup.current
        ?.querySelector(`[data-child-index="${childActive}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, childActive]);

  const keyDown = (event) => {
    if (event.key === "Escape" && !open) return;
    event.stopPropagation();
    if (event.key === "Tab") {
      if (open && renderHeader && !event.shiftKey) {
        const control = popup.current?.querySelector(
          "input:not(:disabled),button:not(:disabled)",
        );
        if (control) {
          event.preventDefault();
          control.focus();
          return;
        }
      }
      close();
      return;
    }
    if (event.key === "Escape") {
      if (open) event.preventDefault();
      if (nested && childActive >= 0) {
        if (drilldown) back();
        else setChildActive(-1);
        return;
      }
      close();
      return;
    }
    if (open && nested && event.key === "ArrowRight") {
      event.preventDefault();
      if (!drilldown || !parent) choose(visible[active]);
      return;
    }
    if (open && nested && event.key === "ArrowLeft") {
      event.preventDefault();
      if (drilldown) back();
      else setChildActive(-1);
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        show();
        return;
      }
      const choices = inSubmenu ? children : visible;
      const current = inSubmenu ? childActive : active;
      const next =
        event.key === "Home"
          ? nextEnabled(choices, -1, 1)
          : event.key === "End"
            ? nextEnabled(choices, 0, -1)
            : nextEnabled(choices, current, event.key === "ArrowDown" ? 1 : -1);
      if (inSubmenu) setChildActive(next);
      else {
        setActive(next);
        if (nested && !drilldown) setBranch(visible[next]?.value ?? null);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) choose(inSubmenu ? children[childActive] : visible[active]);
      else show();
    }
  };

  return (
    <span
      ref={anchor}
      className={`autocomplete nodrag nowheel ${selected?.icon ? "has-icon" : ""} ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {selected?.icon && (
        <span className="autocomplete-selected-icon">{selected.icon}</span>
      )}
      <input
        ref={input}
        id={inputId}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={
          open ? (nested ? `${listId} ${childListId}` : listId) : undefined
        }
        aria-activedescendant={
          open && childActive >= 0
            ? `${childListId}-${childActive}`
            : open && active >= 0
              ? `${listId}-${active}`
              : undefined
        }
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={open ? query : selectedLabel}
        placeholder={(open && searchPlaceholder) || selectedLabel || "Choose…"}
        title={selectedLabel}
        onFocus={show}
        onClick={show}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={keyDown}
        onBlur={(event) => {
          if (!popup.current?.contains(event.relatedTarget)) close();
        }}
      />
      {open ? (
        <Search size={12} aria-hidden="true" />
      ) : (
        <ChevronDown size={13} aria-hidden="true" />
      )}
      {open &&
        position &&
        createPortal(
          <div
            ref={popup}
            id={nested ? undefined : listId}
            role={nested ? "presentation" : "listbox"}
            aria-label={nested ? undefined : label}
            className={`autocomplete-popup nodrag nowheel ${nested ? "has-submenu" : ""} ${drilldown ? "is-drilldown" : ""} ${inSubmenu ? "in-submenu" : ""} ${popupClassName}`}
            style={position}
            onPointerDown={(event) => {
              if (!event.target.closest("input,button")) event.preventDefault();
              event.stopPropagation();
            }}
            onBlur={(event) => {
              if (
                !popup.current?.contains(event.relatedTarget) &&
                !anchor.current?.contains(event.relatedTarget)
              )
                close();
            }}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                input.current?.focus();
                close();
              }
            }}
          >
            {renderHeader && (
              <div className="autocomplete-popup-header">
                {renderHeader({ parent })}
              </div>
            )}
            <div
              className={nested ? "autocomplete-branches" : undefined}
              role={nested ? "listbox" : undefined}
              id={nested ? listId : undefined}
              aria-label={nested ? label : undefined}
            >
              {nested && (
                <div className="autocomplete-menu-heading">{groupLabel}</div>
              )}
              {visible.length ? (
                visible.map((option, index) => (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={
                      String(option.value) === String(value) ||
                      Boolean(
                        option.children?.some(
                          (child) => String(child.value) === String(value),
                        ),
                      )
                    }
                    aria-haspopup={
                      option.children?.length ? "listbox" : undefined
                    }
                    aria-expanded={
                      option.children?.length
                        ? option.value === branch
                        : undefined
                    }
                    aria-disabled={option.disabled || undefined}
                    title={option.description || option.label}
                    data-option-index={index}
                    className={`autocomplete-option ${active === index ? "is-active" : ""} ${option.disabled ? "is-disabled" : ""}`}
                    onPointerMove={() => {
                      if (!option.disabled) {
                        setActive(index);
                        if (nested && !drilldown) {
                          setBranch(option.value);
                          setChildActive(-1);
                        }
                      }
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      choose(option);
                    }}
                  >
                    {option.icon && (
                      <span className="autocomplete-option-icon">
                        {option.icon}
                      </span>
                    )}
                    <span className="autocomplete-option-copy">
                      <span>{option.label}</span>
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </span>
                    {String(option.value) === String(value) && (
                      <Check size={13} aria-hidden="true" />
                    )}
                    {option.children?.length > 0 && (
                      <ChevronRight size={13} aria-hidden="true" />
                    )}
                  </div>
                ))
              ) : (
                <div className="autocomplete-empty" role="status">
                  No matching options
                </div>
              )}
            </div>
            {nested && (
              <div
                className="autocomplete-models"
                role="listbox"
                id={childListId}
                aria-label={parent ? `${parent.label} models` : "Models"}
              >
                <div className="autocomplete-menu-heading">
                  <button
                    className="autocomplete-submenu-back"
                    aria-label={`Back to ${groupLabel.toLowerCase()}`}
                    onClick={() => (drilldown ? back() : setChildActive(-1))}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  {parent ? `${parent.label} · models` : "Choose a provider"}
                </div>
                {children.map((option, index) => (
                  <div
                    key={option.value}
                    id={`${childListId}-${index}`}
                    role="option"
                    aria-selected={String(option.value) === String(value)}
                    aria-disabled={option.disabled || undefined}
                    data-child-index={index}
                    className={`autocomplete-option ${childActive === index ? "is-active" : ""} ${option.disabled ? "is-disabled" : ""}`}
                    title={option.description || option.label}
                    onPointerMove={() =>
                      !option.disabled && setChildActive(index)
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      choose(option);
                    }}
                  >
                    {option.icon && (
                      <span className="autocomplete-option-icon">
                        {option.icon}
                      </span>
                    )}
                    <span className="autocomplete-option-copy">
                      <span>{option.label}</span>
                      {option.description && (
                        <small>{option.description}</small>
                      )}
                    </span>
                    {String(option.value) === String(value) && (
                      <Check size={13} aria-hidden="true" />
                    )}
                  </div>
                ))}
                {!children.length && (
                  <div className="autocomplete-empty">No matching models</div>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}
