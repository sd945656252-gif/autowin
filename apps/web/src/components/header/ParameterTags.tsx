export function ParameterTags({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span key={item} className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-350">
          {item}
        </span>
      ))}
    </div>
  );
}
