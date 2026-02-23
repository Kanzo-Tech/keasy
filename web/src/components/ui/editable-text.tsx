import * as React from "react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function EditableText({
  value,
  onSave,
  className,
  onBlur,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onSave: (value: string) => void
}) {
  const [draft, setDraft] = React.useState(value)
  const ref = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (document.activeElement !== ref.current) {
      setDraft(value)
    }
  }, [value])

  function commit() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    } else {
      setDraft(value)
    }
  }

  return (
    <Input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit()
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          ref.current?.blur()
        }
        if (e.key === "Escape") {
          setDraft(value)
          ref.current?.blur()
        }
        onKeyDown?.(e)
      }}
      className={cn(
        "bg-transparent border-transparent rounded-none shadow-none h-auto p-0 focus-visible:ring-0 focus-visible:border-border",
        className,
      )}
      {...props}
    />
  )
}

export { EditableText }
