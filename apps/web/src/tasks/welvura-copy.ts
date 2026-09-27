export function splitWelvuraInstruction(instruction: string): {
  lead: string;
  meta: string | null;
} {
  const trimmed = instruction.trim();
  const idx = trimmed.search(/Засчитываются|начиная с \d|\(/);
  if (idx > 8) {
    return {
      lead: trimmed.slice(0, idx).trim(),
      meta: trimmed.slice(idx).trim() || null,
    };
  }
  return { lead: trimmed, meta: null };
}

export function welvuraLockedStatus(accountApproved: boolean): string {
  return accountApproved ? "Закрыто" : "После привязки";
}
