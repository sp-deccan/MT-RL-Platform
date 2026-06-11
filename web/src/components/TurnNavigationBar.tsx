type TurnNavigationBarProps = {
  turnCount: number
  activeIndex: number
  onSelect: (index: number) => void
  onAdd?: () => void
  onRemove?: (index: number) => void
  allowRemove?: boolean
  showAdd?: boolean
}

export function TurnNavigationBar({
  turnCount,
  activeIndex,
  onSelect,
  onAdd,
  onRemove,
  allowRemove = true,
  showAdd = true,
}: TurnNavigationBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Array.from({ length: turnCount }, (_, index) => {
        const active = index === activeIndex
        return (
          <button
            key={`turn-tab-${index}`}
            type="button"
            onClick={() => onSelect(index)}
            className={
              active
                ? 'rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white dark:bg-violet-600'
                : 'rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-xs font-medium text-zinc-700 hover:border-violet-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'
            }
          >
            Turn {index + 1}
          </button>
        )
      })}
      {showAdd && onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full border border-dashed border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-violet-400 hover:text-violet-700 dark:border-zinc-500 dark:text-zinc-400 dark:hover:text-violet-300"
        >
          + Add turn
        </button>
      ) : null}
      {allowRemove && turnCount > 1 && onRemove ? (
        <button
          type="button"
          onClick={() => onRemove(activeIndex)}
          className="ml-auto text-xs text-red-600 hover:underline dark:text-red-400"
        >
          Remove turn {activeIndex + 1}
        </button>
      ) : null}
    </div>
  )
}
