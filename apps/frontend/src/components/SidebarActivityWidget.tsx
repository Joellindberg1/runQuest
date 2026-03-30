import React, { useState } from 'react';

interface SidebarActivityWidgetProps {
  items: (React.ReactNode | null | undefined)[];
}

export const SidebarActivityWidget: React.FC<SidebarActivityWidgetProps> = ({ items }) => {
  const [active, setActive] = useState(0);
  const filtered = items.filter(Boolean) as React.ReactNode[];

  if (filtered.length === 0) return null;

  // Keep active index in bounds if items shrink
  const safeActive = Math.min(active, filtered.length - 1);

  return (
    <div className="flex flex-col gap-1.5">
      {filtered[safeActive]}
      {filtered.length > 1 && (
        <div className="flex justify-center gap-1.5 pt-0.5">
          {filtered.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className="rounded-full transition-all duration-150"
              style={{
                width: i === safeActive ? 16 : 6,
                height: 6,
                background: i === safeActive
                  ? 'var(--rq-gold)'
                  : 'rgba(255,255,255,0.18)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
};
