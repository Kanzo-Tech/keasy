import { toast } from "@kanzo-tech/ui";

const MAX_LENGTH = 100;

const VERBOSE_PREFIXES = [
  /^Error:\s*/i,
  /^Failed to\s*/i,
  /^Unable to\s*/i,
  /^Could not\s*/i,
];

function simplify(message: string): string {
  let msg = message.split("\n")[0];
  for (const prefix of VERBOSE_PREFIXES) {
    msg = msg.replace(prefix, "");
  }
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

export function toastError(error: unknown, fallback: string): void;
export function toastError(message: string): void;
export function toastError(errorOrMessage: unknown, fallback?: string): void {
  const message =
    typeof errorOrMessage === "string"
      ? errorOrMessage
      : errorOrMessage instanceof Error
        ? errorOrMessage.message
        : fallback ?? "Something went wrong";
  _toastError(message);
}

function _toastError(message: string) {
  const short = simplify(message);
  if (short.length <= MAX_LENGTH) {
    toast.create({
      title: short,
      description: short !== message ? message : undefined,
      type: "error",
    });
  } else {
    toast.create({
      title: short.slice(0, MAX_LENGTH) + "...",
      description: message,
      type: "error",
    });
  }
}
