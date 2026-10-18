export class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export class Conflict extends AppError {
  constructor() { super(409, 'Les données ont changé. Recharge la page puis réessaie.'); }
}
