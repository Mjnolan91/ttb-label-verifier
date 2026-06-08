/**
 * App-wide constants. Kept in one place so the title shown in the UI and the page
 * <title> metadata stay in lockstep (and are unit-testable without rendering React).
 */
export const APP_TITLE = "TTB Label Verifier";

export const APP_DESCRIPTION =
  "Read an alcohol label (front and back) with AI into the full set of TTB-required fields, check it " +
  "for completeness against TTB's requirements by beverage type, and export the result as JSON or CSV.";
