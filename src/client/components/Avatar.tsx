const PALETTES = [
  ["#ff7a59", "#c2185b"],
  ["#ffd166", "#ef8a17"],
  ["#06d6a0", "#118a7e"],
  ["#4cc9f0", "#4361ee"],
  ["#b388ff", "#6a3de8"],
  ["#ff8fab", "#d63384"],
  ["#9be15d", "#00b37a"],
  ["#f7b267", "#f25c54"],
  ["#80ffdb", "#5390d9"],
  ["#e0aaff", "#9d4edd"],
  ["#ffe066", "#f08c00"],
  ["#a5d8ff", "#1c7ed6"],
];

export function Avatar({ name, index, size = 44, className }: { name: string; index: number; size?: number; className?: string }) {
  const [a, b] = PALETTES[((index % PALETTES.length) + PALETTES.length) % PALETTES.length];
  const initial = Array.from(name.trim() || "?")[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={`avatar ${className ?? ""}`}
      style={{ width: size, height: size, fontSize: size * 0.44, background: `linear-gradient(140deg, ${a}, ${b})` }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

export const AVATAR_PALETTES = PALETTES;
