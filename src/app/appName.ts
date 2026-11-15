// The app's OWN name is a build-time identity, not a translation: the
// Blocks localization store is TENANT-wide, and this tenant also serves the
// user's other apps — one of them carries "app.name": "Mess Manager",
// which cloud-merged over the built-in default a few seconds after load
// and rebranded this app mid-session. The brand reads this constant
// instead; the dictionary key stays only so the language picker and any
// future cloud copy can't break other callers.
export const APP_NAME = "TestPilot AI";
