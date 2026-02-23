import * as React from "react"

import { Input } from "@/components/ui/input"

interface SecretInputProps extends Omit<React.ComponentProps<typeof Input>, "type" | "autoComplete"> {
  hasStoredValue?: boolean;
}

function SecretInput({ hasStoredValue, placeholder, ...props }: SecretInputProps) {
  return (
    <Input
      type="password"
      autoComplete="off"
      placeholder={
        hasStoredValue && !props.value
          ? "Leave empty to keep current"
          : placeholder
      }
      {...props}
    />
  )
}

export { SecretInput }
