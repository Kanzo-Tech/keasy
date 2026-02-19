import { toast } from "sonner";

const MAX_LENGTH = 100;

export function toastError(message: string) {
  if (message.length <= MAX_LENGTH) {
    toast.error(message);
  } else {
    toast.error(message.slice(0, MAX_LENGTH) + "...", {
      description: message,
    });
  }
}
