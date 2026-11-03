export function JsonPanel({ value }: { value: unknown }) {
  return <pre>{typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}</pre>;
}
