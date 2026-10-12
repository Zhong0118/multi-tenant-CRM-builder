/** A 3×3 grid of cells with one filled in: a row of the sheet that someone has
 *  picked up and is moving forward. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      aria-hidden="true"
      focusable="false"
    >
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((column) => {
          const active = row === 1 && column === 2;
          return (
            <rect
              key={`${row}-${column}`}
              x={1 + column * 8}
              y={1 + row * 8}
              width="6"
              height="6"
              rx="1.5"
              fill={active ? "#167568" : "none"}
              stroke={active ? "#167568" : "currentColor"}
              strokeWidth="1.5"
              opacity={active ? 1 : 0.55}
            />
          );
        }),
      )}
    </svg>
  );
}
