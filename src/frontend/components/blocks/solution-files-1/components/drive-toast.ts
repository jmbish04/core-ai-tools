import { toast as sonnerToast, type ExternalToast } from "sonner"

const DRIVE_TOAST: ExternalToast = {
  classNames: {
    // The gap is NOT set here. The Toaster already applies `!gap-2`, and a
    // competing `!gap-1.5` carries the same importance, so the winner is CSS
    // source order, which Tailwind emits ascending: `gap-2` always wins.
    // Pulling the label in from the icon's own trailing margin sidesteps that
    // fight entirely and leaves the primitive's rule untouched.
    icon: "-me-0.5 [&>svg]:size-4!",
  },
}

/** Merges the block's toast styling, letting a call site still override. */
function withDriveToast(options?: ExternalToast): ExternalToast {
  return {
    ...DRIVE_TOAST,
    ...options,
    classNames: { ...DRIVE_TOAST.classNames, ...options?.classNames },
  }
}

export const toast = {
  success: (message: string, options?: ExternalToast) =>
    sonnerToast.success(message, withDriveToast(options)),
  info: (message: string, options?: ExternalToast) =>
    sonnerToast.info(message, withDriveToast(options)),
  error: (message: string, options?: ExternalToast) =>
    sonnerToast.error(message, withDriveToast(options)),
}