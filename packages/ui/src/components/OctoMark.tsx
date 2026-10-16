import type { ImgHTMLAttributes } from 'react';
import octobooksIcon from '../assets/octobooks-icon.png';

/** Approved cap-and-pencil icon, shared by the sidebar and learning screens. */
export function OctoMark(props: ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={octobooksIcon} alt="" aria-hidden="true" {...props} />;
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
