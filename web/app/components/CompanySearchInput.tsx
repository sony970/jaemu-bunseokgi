"use client";

import { useEffect, useRef, useState } from "react";

type Suggestion = { corpName: string; stockCode: string };

export default function CompanySearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleChange(v: string) {
    onChange(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = v.trim();
    if (!q) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/corp-search?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        setSuggestions(data.results ?? []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      }
    }, 200);
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        className="border border-gray-300 rounded-lg px-3 py-2 w-44 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-56 max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm">
          {suggestions.map((s) => (
            <li key={s.corpName}>
              <button
                type="button"
                onClick={() => {
                  onChange(s.corpName);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-indigo-50"
              >
                <span className="font-medium">{s.corpName}</span>
                {s.stockCode && <span className="text-gray-400 ml-2 text-xs">{s.stockCode}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
