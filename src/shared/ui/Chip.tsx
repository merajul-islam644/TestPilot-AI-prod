export function ChipList({ empty, items }: { empty: string; items?: string[] }) {
  if (!items || items.length === 0) return <p className="muted">{empty}</p>;

  return (
    <div className="chips">
      {items.map((item) => <span key={item} className="chip">{item}</span>)}
    </div>
  );
}
