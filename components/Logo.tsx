/** A torn ticket stub. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <g transform="rotate(-8 16 16)">
        <path d="M5 8h22v5a3 3 0 0 0 0 6v5H5v-5a3 3 0 0 0 0-6z" fill="#b9472d" />
        <path d="M11 9.5v13" stroke="#fff8f2" strokeWidth="1.4" strokeDasharray="1.6 1.6" />
        <path d="M15 13h8M15 16h6M15 19h7" stroke="#fff8f2" strokeWidth="1.6" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export default function Logo() {
  return <><Mark />Stubbook</>;
}
