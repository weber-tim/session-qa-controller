import { onBeforeUnmount, onMounted } from "vue";

/** Escape closes any full-screen overlay — the shared convention across Settings, Help,
 *  Whatsnew, DevLogs, QaTickets and StripDetail. */
export function useEscClose(onClose: () => void): void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  onMounted(() => window.addEventListener("keydown", onKey));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
}
