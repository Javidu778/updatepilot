'use client';

import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const STORAGE_KEY = 'up-theme';
const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  // Read the saved choice after mount. The inline script in layout.tsx already applied it before first paint.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'system') setTheme(saved);
    } catch {
      // Storage can be unavailable (private mode). The toggle still works for this visit.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors.
    }
  }

  return (
    <fieldset className="theme-toggle">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((option) => (
        <label key={option.value} className="theme-option">
          <input
            type="radio"
            name="theme"
            value={option.value}
            checked={theme === option.value}
            onChange={() => choose(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
