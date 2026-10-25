// The first screen of setup: three short slides about what Lattice does, each
// with a small in-brand drawing (inline SVG on the theme tokens), dots, and
// Back / Skip intro / Next ("Get started" on the last). Arrow keys move between
// slides. The text fades in on change, except with reduced motion (onboarding.css).
import { useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { CLASS_PALETTE } from '../../model/constants';

const [BLUE, GREEN, RED, PLUM] = CLASS_PALETTE;

const SLIDES = [
  {
    title: 'Everything due, in one place',
    text: 'Bring in your Google Classroom work or a schedule file. Assignments, tests and the dates that changed in an announcement end up in one list.',
    art: <DueArt />,
  },
  {
    title: 'Planned into your real free time',
    text: 'Tell Lattice when you usually study. It places the work into those hours, around school and your other commitments.',
    art: <WeekArt />,
  },
  {
    title: 'A plan you can trust',
    text: 'Nothing is planned after its due date. Sessions you move or add yourself stay where you put them. If work does not fit, Lattice says so instead of hiding it.',
    art: <PromiseArt />,
  },
];

/** `titleRef` goes on the slide title (focusable with tabIndex -1), so the wizard can move focus there. */
export function WelcomeSlides({ onDone, titleRef }: { onDone: () => void; titleRef?: Ref<HTMLHeadingElement> }) {
  const [index, setIndex] = useState(0);
  const backRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const last = index === SLIDES.length - 1;
  const slide = SLIDES[index];
  const go = (n: number) => {
    const to = Math.max(0, Math.min(SLIDES.length - 1, n));
    // Back is disabled on the first slide: move focus to Next first, so it does not fall to the page.
    if (to === 0 && document.activeElement === backRef.current) nextRef.current?.focus();
    setIndex(to);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(index + 1);
    else if (e.key === 'ArrowLeft') go(index - 1);
  };

  return (
    <section className="card ob-slides" aria-roledescription="carousel" aria-label="Welcome to Lattice Study" onKeyDown={onKey}>
      <div className="ob-art" aria-hidden="true">
        {slide.art}
      </div>
      <div className="card-body stack">
        {/* One lasting live region so screen readers announce each new slide; only the inner text is replaced (and fades in). */}
        <div aria-live="polite" aria-roledescription="slide" aria-label={`${index + 1} of ${SLIDES.length}`} role="group">
          <div key={index} className="ob-fade">
            <h2 className="ob-slide-title" ref={titleRef} tabIndex={-1}>
              {slide.title}
            </h2>
            <p className="muted">{slide.text}</p>
          </div>
        </div>
        <div className="ob-dots">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className="ob-dot"
              aria-label={`Slide ${i + 1}: ${s.title}`}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <div className="row ob-actions">
          <button type="button" className="btn ghost" ref={backRef} onClick={() => go(index - 1)} disabled={index === 0}>
            Back
          </button>
          <span className="spacer" />
          {!last ? (
            <button type="button" className="btn ghost" onClick={onDone}>
              Skip intro
            </button>
          ) : null}
          <button type="button" className="btn primary" ref={nextRef} onClick={last ? onDone : () => go(index + 1)}>
            {last ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </section>
  );
}

// The drawings: 280 × 140, theme colors from onboarding.css classes; class colors only where they stand for a class.

function DueArt() {
  const rows = [
    { color: BLUE, w: 120, due: 'Today' },
    { color: RED, w: 96, due: 'Fri' },
    { color: PLUM, w: 136, due: 'Mon' },
  ];
  return (
    <svg viewBox="0 0 280 140">
      {rows.map((r, i) => (
        <g key={r.due} transform={`translate(40 ${18 + i * 38})`}>
          <rect className="ob-svg-card" width="200" height="30" rx="8" />
          <rect x="0" width="4" height="30" rx="2" fill={r.color} />
          <rect className="ob-svg-line" x="14" y="9" width={r.w} height="5" rx="2.5" />
          <rect className="ob-svg-faint" x="14" y="18" width={r.w * 0.6} height="4" rx="2" />
          <rect className={i === 0 ? 'ob-svg-pill-hot' : 'ob-svg-pill'} x="158" y="8" width="34" height="14" rx="7" />
          <text className={i === 0 ? 'ob-svg-pill-text-hot' : 'ob-svg-pill-text'} x="175" y="18.5" textAnchor="middle">
            {r.due}
          </text>
        </g>
      ))}
    </svg>
  );
}

function WeekArt() {
  const blocks = [
    { day: 0, y: 70, h: 18, color: BLUE },
    { day: 1, y: 76, h: 24, color: RED },
    { day: 2, y: 70, h: 14, color: GREEN },
    { day: 3, y: 82, h: 20, color: PLUM },
    { day: 4, y: 70, h: 16, color: BLUE },
  ];
  return (
    <svg viewBox="0 0 280 140">
      <defs>
        <pattern id="ob-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="ob-svg-busy" width="6" height="6" />
          <line className="ob-svg-stripe" x1="0" y1="0" x2="0" y2="6" strokeWidth="3" />
        </pattern>
      </defs>
      {[0, 1, 2, 3, 4].map((d) => (
        <g key={d} transform={`translate(${30 + d * 46} 14)`}>
          <rect className="ob-svg-card" width="40" height="112" rx="6" />
          <rect x="2" y="4" width="36" height="46" rx="4" fill="url(#ob-hatch)" />
          <rect className="ob-svg-free" x="2" y="54" width="36" height="54" rx="4" />
        </g>
      ))}
      {blocks.map((b) => (
        <g key={b.day} transform={`translate(${34 + b.day * 46} ${b.y})`}>
          <rect width="32" height={b.h} rx="3" fill={b.color} opacity="0.18" />
          <rect width="3" height={b.h} rx="1.5" fill={b.color} />
        </g>
      ))}
    </svg>
  );
}

function PromiseArt() {
  return (
    <svg viewBox="0 0 280 140">
      <rect className="ob-svg-card" x="30" y="30" width="220" height="80" rx="10" />
      <line className="ob-svg-faint-line" x1="40" y1="70" x2="240" y2="70" />
      <g transform="translate(52 52)">
        <rect width="54" height="36" rx="5" fill={BLUE} opacity="0.18" />
        <rect width="4" height="36" rx="2" fill={BLUE} />
      </g>
      <g transform="translate(116 52)">
        <rect width="54" height="36" rx="5" fill={GREEN} opacity="0.18" />
        <rect width="4" height="36" rx="2" fill={GREEN} />
        {/* A lock: this session was moved by the person, so it stays. */}
        <g className="ob-svg-lock" transform="translate(21 10)">
          <rect x="0" y="7" width="12" height="9" rx="2" />
          <path d="M3 7V5a3 3 0 0 1 6 0v2" fill="none" strokeWidth="2" />
        </g>
      </g>
      <line className="ob-svg-due" x1="196" y1="40" x2="196" y2="100" strokeWidth="2" />
      <rect className="ob-svg-pill-hot" x="178" y="104" width="36" height="14" rx="7" />
      <text className="ob-svg-pill-text-hot" x="196" y="114.5" textAnchor="middle">
        Due
      </text>
    </svg>
  );
}
