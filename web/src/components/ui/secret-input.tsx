"use client"

import * as React from "react"
import { Eye, EyeOff } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

interface SecretInputProps extends Omit<React.ComponentProps<"input">, "type" | "autoComplete"> {
  hasStoredValue?: boolean;
}

function SecretInput({ hasStoredValue, placeholder, ...props }: SecretInputProps) {
  const [show, setShow] = React.useState(false)

  return (
    <InputGroup>
      <InputGroupInput
        type={show ? "text" : "password"}
        autoComplete="off"
        placeholder={
          hasStoredValue && !props.value
            ? "Leave empty to keep current"
            : placeholder
        }
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow(!show)}
        >
          {show ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export { SecretInput }
