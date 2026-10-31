// Deliberately not a Next route. No activation flag, auth shortcut or repository wiring.
// Future M2M/HTTP adapter requires a separate reviewed change, durable storage and gates.
export function disabledHttpContract(): { status: 503; body: { code: 'DISABLED' } } {
  return { status: 503, body: { code: 'DISABLED' } };
}
