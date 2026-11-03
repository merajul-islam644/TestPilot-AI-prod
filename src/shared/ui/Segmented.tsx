export type SegmentOption<T extends string> = { id: T; label: string };

/** Small segmented control for 2-5 mutually exclusive options (ranges, filters, theme). */
export function Segmented<T extends string>({ onChange, options, value }: { onChange: (id: T) => void; options: SegmentOption<T>[]; value: T }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option.id === value}
          className={option.id === value ? "on" : ""}
          key={option.id}
          onClick={() => onChange(option.id)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
