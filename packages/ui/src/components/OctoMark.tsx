import type { SVGProps } from 'react';

/** Original octobooks glyph: one curious mind, eight paths to explore. */
export function OctoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" {...props}>
      <path d="M31 47V35a19 19 0 0 1 38 0v12c0 10-38 10-38 0Z" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="5.5" strokeLinecap="round">
        <path d="M33 44C24 44 28 62 16 59M37 48C29 54 36 69 24 68M43 50C38 58 45 75 35 77M46.5 51V79M53.5 51V79M57 50C62 58 55 75 65 77M63 48C71 54 64 69 76 68M67 44C76 44 72 62 84 59" />
      </g>
      <path d="M40 31v5m20-5v5" stroke="var(--octo-eye, var(--bg))" strokeWidth="4" strokeLinecap="round" />
      <path d="M45 42q5 5 10 0" stroke="var(--octo-eye, var(--bg))" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="16" cy="59" r="3.5" fill="currentColor" /><circle cx="84" cy="59" r="3.5" fill="currentColor" />
    </svg>
  );
}

/** A small learning map, built from the same glyph and branch motif as the app. */
export function OctoGarden() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-44 w-64 text-accent sm:h-48 sm:w-72">
      <svg viewBox="0 0 288 192" className="absolute inset-0 h-full w-full" fill="none">
        <circle cx="144" cy="96" r="76" stroke="currentColor" opacity=".09" />
        <circle cx="144" cy="96" r="55" fill="currentColor" opacity=".06" />
        <g stroke="currentColor" strokeWidth="1.5" opacity=".28"><path d="M107 82C77 82 86 43 50 43M181 82c30 0 21-39 57-39M105 112c-30 0-20 39-54 39M182 112c30 0 21 39 55 39" /></g>
        <g fill="var(--surface)" stroke="currentColor" strokeWidth="1.5"><rect x="25" y="29" width="58" height="28" rx="10" /><rect x="205" y="29" width="58" height="28" rx="10" /><rect x="23" y="137" width="64" height="28" rx="10" /><rect x="201" y="137" width="64" height="28" rx="10" /></g>
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M40 40h26m-26 7h17M220 40h26m-26 7h17M39 148h30m-30 7h20M217 148h30m-30 7h20" opacity=".5" /></g>
        <circle cx="95" cy="25" r="3" fill="#f2a38a" /><circle cx="193" cy="172" r="4" fill="#f2a38a" /><circle cx="25" cy="104" r="3" stroke="currentColor" opacity=".3" /><circle cx="267" cy="93" r="5" stroke="currentColor" opacity=".18" />
      </svg>
      <OctoMark className="absolute left-1/2 top-1/2 size-28 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}
