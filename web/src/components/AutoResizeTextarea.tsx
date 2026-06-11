import { useCallback, useLayoutEffect, useRef } from 'react'

type AutoResizeTextareaProps = {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  className?: string
  minRows?: number
}

export function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  className = '',
  minRows = 2,
}: AutoResizeTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const syncHeight = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    el.style.overflowY =
      el.scrollHeight > el.clientHeight ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    syncHeight()
  }, [value, syncHeight])

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => {
        onChange(e)
        requestAnimationFrame(syncHeight)
      }}
      rows={minRows}
      placeholder={placeholder}
      className={`resize-none overflow-hidden ${className}`.trim()}
    />
  )
}
