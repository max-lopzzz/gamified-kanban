import { useEffect, useRef, useState } from "react";

/*
 * A searchable multi-select: selected items show as removable chips, typing
 * filters a dropdown of the rest, click to add.
 *
 * options: [{ value, label, group?, muted? }]
 * value:   array of selected `value`s
 */
export default function TokenMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyText = "Nothing to choose",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = value
    .map((v) => options.find((o) => o.value === v))
    .filter(Boolean);
  const q = query.trim().toLowerCase();
  const matches = options.filter(
    (o) => !value.includes(o.value) && (!q || o.label.toLowerCase().includes(q))
  );

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const add = (v) => {
    onChange([...value, v]);
    setQuery("");
  };
  const remove = (v) => onChange(value.filter((x) => x !== v));

  return (
    <div className="token-select" ref={rootRef}>
      <div
        className="token-select-control"
        onClick={() => {
          setOpen(true);
          rootRef.current?.querySelector("input")?.focus();
        }}
      >
        {selected.map((o) => (
          <span key={o.value} className="token-chip">
            {o.label}
            <button
              type="button"
              className="token-chip-x"
              aria-label={`Remove ${o.label}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(o.value);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          className="token-select-input"
          value={query}
          placeholder={selected.length ? "" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault(); // never submit the surrounding task form
              if (matches.length > 0) add(matches[0].value);
            } else if (
              e.key === "Backspace" &&
              query === "" &&
              value.length > 0
            ) {
              remove(value[value.length - 1]);
            }
          }}
        />
      </div>

      {open && (
        <div className="token-select-menu">
          {matches.length === 0 ? (
            <div className="token-select-empty">
              {q ? "No matches" : emptyText}
            </div>
          ) : (
            matches.map((o) => (
              <button
                key={o.value}
                type="button"
                className={"token-select-option" + (o.muted ? " muted" : "")}
                onClick={() => add(o.value)}
              >
                <span>{o.label}</span>
                {o.group && (
                  <span className="token-select-group">{o.group}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
