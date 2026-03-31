// 📋 PatchNotesModal — blocking modal shown when a new patch note slug is unseen
import React, { useEffect, useState } from 'react';
import { CheckCircle, X, Zap } from 'lucide-react';
import type { PatchNote } from '../patchNotes';

interface PatchNotesModalProps {
  note: PatchNote;
  onClose: () => void;
}

export const PatchNotesModal: React.FC<PatchNotesModalProps> = ({ note, onClose }) => {
  const [visible, setVisible] = useState(false);

  // 500ms delay before appearing — lets layout settle
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <div
        className="relative w-full max-w-md rounded-xl border-2 p-6 shadow-2xl"
        style={{
          background: 'hsl(var(--sidebar))',
          borderColor: 'var(--rq-gold)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-4 h-4" style={{ color: 'var(--rq-gold)' }} />
              <span
                className="uppercase tracking-widest text-xs"
                style={{ color: 'var(--rq-gold)', fontFamily: 'Barlow Condensed, sans-serif', fontWeight: 700 }}
              >
                {note.version} — What's new
              </span>
            </div>
            <h2
              className="text-xl leading-tight"
              style={{ fontFamily: 'Bebas Neue, sans-serif', letterSpacing: '0.04em', color: 'hsl(var(--foreground))' }}
            >
              {note.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 p-1 rounded-md opacity-50 hover:opacity-100 transition-opacity"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Divider */}
        <div className="mb-4 h-px" style={{ background: 'linear-gradient(to right, var(--rq-gold), transparent)' }} />

        {/* Items */}
        <ul className="space-y-2.5 mb-6">
          {note.items.map((item, i) => (
            <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/80">
              <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--rq-gold)' }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-lg text-sm font-semibold uppercase tracking-wide transition-opacity hover:opacity-90"
          style={{
            background: 'var(--rq-gold)',
            color: '#000',
            fontFamily: 'Barlow Condensed, sans-serif',
            letterSpacing: '0.1em',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
};
