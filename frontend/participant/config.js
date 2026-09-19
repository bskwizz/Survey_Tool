// Runtime configuration for the static participant app.
// When the frontend is served from a different origin than the backend
// (e.g. Azure Static Web Apps + a separate API host), set BACKEND_BASE_URL
// accordingly. When served from the same origin as the backend (simplest
// local dev / single-host deployment), leave it as an empty string so
// requests are relative.
window.CLASSROOM_SURVEY_CONFIG = {
  BACKEND_BASE_URL: '',
};
