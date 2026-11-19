// The app's OWN name is a build-time identity, not a translation or a user
// preference: the Blocks localization store is TENANT-wide and this tenant
// also serves the user's other apps, and the old Settings-side rename field
// let a stale localStorage value override the brand. Both are gone — the
// brand reads this constant, everywhere, always.
export const APP_NAME = "TestPilot";
